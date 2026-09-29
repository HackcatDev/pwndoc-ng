/*
 * Endpoints of the AI assistant (routes/ai.js) with the models, the ACL and
 * the model provider stubbed, so they run without a database (npm run test:lib).
 */
module.exports = function () {
 describe('AI routes', () => {
  var request = require("supertest")
  var express = require("express")
  var bodyParser = require("body-parser")

  var AUDIT_ID = "660000000000000000000100"
  var FINDING_ID = "660000000000000000000010"

  var permissions = {
    user: ['audits:update', 'ai:generate'],
    reader: ['ai:generate'],
  }
  var fakeAcl = {
    isAllowed: (role, permission) => role === 'admin' || (permissions[role] || []).includes(permission),
    hasPermission: (permission) => (req, res, next) => {
      var role = req.get('X-Test-Role') || 'user'
      if (!fakeAcl.isAllowed(role, permission)) return res.status(403).json({status: 'error', datas: 'Insufficient privileges'})
      req.decodedToken = {role: role, id: 'u1'}
      next()
    },
  }

  var db

  function makeApp() {
    var models = {
      AiConfig: {
        getPublicConfig: async () => Object.assign({}, db.config, {apiKey: undefined, apiKeySet: !!db.config.apiKey}),
        getFullConfig: async () => Object.assign({}, db.config),
        isConfigured: (c) => !!(c && c.apiHost && c.model),
        updateConfig: async (update) => { db.updates.push(update); Object.assign(db.config, update); return {ok: true} },
      },
      Audit: {
        getAiContext: async (isAdmin, auditId) => {
          if (auditId !== AUDIT_ID) throw {fn: 'NotFound', message: 'Audit not found or Insufficient Privileges'}
          return db.audit
        },
      },
      CustomField: {getAll: async () => [{_id: "c1", label: "Business_Impact", fieldType: "text", display: "finding"}]},
      Language: {getAll: async () => [{language: "English", locale: "en"}]},
      Settings: {getAll: async () => db.settings},
    }
    var app = express()
    app.use(bodyParser.json())
    jest.isolateModules(() => {
      jest.doMock("../src/lib/auth", () => ({acl: fakeAcl}))
      var isolatedMongoose = require("mongoose")
      var realModel = isolatedMongoose.model
      isolatedMongoose.model = (name) => models[name] || realModel.call(isolatedMongoose, name)
      try {
        require("../src/routes/ai")(app)
      } finally {
        isolatedMongoose.model = realModel
      }
    })
    return app
  }

  var app, realFetch

  beforeEach(() => {
    db = {
      config: {provider: "openai", apiHost: "https://llm.test/v1", apiKey: "secret", model: "m", prompts: {}},
      updates: [],
      settings: {reviews: {enabled: false}},
      fetches: [],
      answer: {status: 200, body: {choices: [{message: {content: "New **text**"}}]}},
      audit: {
        _id: AUDIT_ID, name: "Audit", language: "en", state: "EDIT", aiEnabled: true, aiPrompts: {},
        company: {name: "ACME"},
        findings: [{_id: FINDING_ID, title: "Stored title", description: "<p>stored</p>", references: []}],
      },
    }
    realFetch = globalThis.fetch
    globalThis.fetch = async (url, options) => {
      db.fetches.push({url, options, body: JSON.parse(options.body)})
      return {ok: db.answer.status < 300, status: db.answer.status, text: async () => JSON.stringify(db.answer.body)}
    }
    app = makeApp()
  })
  afterEach(() => { globalThis.fetch = realFetch })

  var url = `/api/audits/${AUDIT_ID}/findings/${FINDING_ID}/ai`

  describe('AI generate endpoint', () => {
    it('Writes a field from the unsaved values of the editor', async () => {
      db.config.prompts = {description: "Describe {title}: {current_value}"}
      var response = await request(app).post(url).send({field: "description", finding: {title: "Unsaved title", description: "<p>draft</p>", apiKey: "ignored"}})
      expect(response.status).toBe(200)
      expect(response.body.datas).toEqual({field: "description", kind: "html", value: "<p>New <strong>text</strong></p>", model: "m"})
      expect(db.fetches[0].url).toBe("https://llm.test/v1/chat/completions")
      expect(db.fetches[0].body.messages[0].content).toBe("Describe Unsaved title: draft")
    })

    it('Custom field', async () => {
      var response = await request(app).post(url).send({field: "business_impact", finding: {customFields: [{customField: {label: "Business_Impact", fieldType: "text"}, text: "<p>x</p>"}]}})
      expect(response.status).toBe(200)
      expect(response.body.datas.field).toBe("business_impact")
    })

    it('Disabled for the audit', async () => {
      db.audit.aiEnabled = false
      var response = await request(app).post(url).send({field: "title"})
      expect(response.status).toBe(403)
      expect(response.body.datas).toBe("AI features are disabled for this audit")
      expect(db.fetches.length).toBe(0)
    })

    it('Not configured', async () => {
      db.config.model = ""
      var response = await request(app).post(url).send({field: "title"})
      expect(response.status).toBe(422)
    })

    it('Audit under review', async () => {
      db.settings.reviews.enabled = true
      db.audit.state = "REVIEW"
      expect((await request(app).post(url).send({field: "title"})).status).toBe(403)
    })

    it('Needs the permission to edit audits', async () => {
      var response = await request(app).post(url).set('X-Test-Role', 'reader').send({field: "title"})
      expect(response.status).toBe(403)
    })

    it('Unknown finding, unknown field, missing field', async () => {
      expect((await request(app).post(`/api/audits/${AUDIT_ID}/findings/660000000000000000000099/ai`).send({field: "title"})).status).toBe(404)
      expect((await request(app).post(url).send({field: "nope"})).status).toBe(422)
      expect((await request(app).post(url).send({})).status).toBe(422)
    })

    it('An error of the provider is a 502 with a readable message', async () => {
      db.answer = {status: 401, body: {error: {message: "bad key"}}}
      var response = await request(app).post(url).send({field: "title"})
      expect(response.status).toBe(502)
      expect(response.body.datas).toBe("The API key was refused by the model provider: bad key")
    })
  })

  describe('AI configuration endpoints', () => {
    it('Status for users', async () => {
      var response = await request(app).get("/api/ai/status")
      expect(response.status).toBe(200)
      expect(response.body.datas.configured).toBe(true)
      expect(response.body.datas.fields.map(f => f.key)).toContain("business_impact")
      expect(response.body.datas.placeholders.map(p => p.name)).toContain("business_impact")
      expect(response.body.datas.defaultPrompts.title).toContain("{selected_field}")
      expect(JSON.stringify(response.body)).not.toContain("secret")
    })

    it('Configuration is for admins, never shows the key', async () => {
      expect((await request(app).get("/api/ai/config")).status).toBe(403)
      var response = await request(app).get("/api/ai/config").set('X-Test-Role', 'admin')
      expect(response.status).toBe(200)
      expect(JSON.stringify(response.body)).not.toContain("secret")
    })

    it('Update validates', async () => {
      var bad = await request(app).put("/api/ai/config").set('X-Test-Role', 'admin').send({apiHost: "nope"})
      expect(bad.status).toBe(422)
      var ok = await request(app).put("/api/ai/config").set('X-Test-Role', 'admin').send({model: "m2", apiKey: ""})
      expect(ok.status).toBe(200)
      expect(db.updates[0]).toEqual({model: "m2"})
    })

    it('Test reuses the saved key only for the saved host', async () => {
      db.answer = {status: 200, body: {choices: [{message: {content: "OK"}}]}}
      var same = await request(app).post("/api/ai/test").set('X-Test-Role', 'admin').send({apiHost: "https://llm.test/v1", model: "m"})
      expect(same.status).toBe(200)
      expect(same.body.datas.answer).toBe("OK")
      expect(db.fetches[0].options.headers.Authorization).toBe("Bearer secret")
      await request(app).post("/api/ai/test").set('X-Test-Role', 'admin').send({apiHost: "https://elsewhere.test/v1", model: "m"})
      expect(db.fetches[1].url).toBe("https://elsewhere.test/v1/chat/completions")
      expect(db.fetches[1].options.headers.Authorization).toBeUndefined()
    })
  })
 })
}
