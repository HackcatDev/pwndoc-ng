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
        updateOne: async (query, update) => { db.auditUpdates.push(update.$set); return {} },
        findOne: (query) => ({lean: async () => ({findings: db.audit.findings.filter(f => String(f._id) === String(query['findings._id']))})}),
      },
      Image: {getOne: async (id) => (db.images[id] ? {value: db.images[id]} : null)},
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
      auditUpdates: [],
      images: {},
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
      expect(response.body.datas).toEqual({field: "description", kind: "html", value: "<p>New <strong>text</strong></p>", model: "m", images: 0})
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

  describe('Quality advisor endpoint', () => {
    var reviewUrl = `/api/audits/${AUDIT_ID}/findings/${FINDING_ID}/ai/review`
    var { PNG } = require('pngjs')
    var png = () => { var p = new PNG({width: 4, height: 4}); p.data.fill(200); return 'data:image/png;base64,' + PNG.sync.write(p).toString('base64') }

    beforeEach(() => {
      db.audit.aiAdvisorEnabled = true
      db.answer.body = {choices: [{message: {content: "VERDICT: insufficient\n\n- Add the **Burp** request [here](http://evil.test)"}}]}
    })

    it('stores the advice with the finding and raises the low-quality flag', async () => {
      var response = await request(app).post(reviewUrl)
      expect(response.status).toBe(200)
      expect(response.body.datas.verdict).toBe('insufficient')
      expect(response.body.datas.html).toBe('<ul>\n<li><p>Add the <strong>Burp</strong> request here</p></li>\n</ul>')
      var set = db.auditUpdates[db.auditUpdates.length - 1]
      expect(set['findings.$.aiReview'].verdict).toBe('insufficient')
      expect(set['findings.$.aiReview'].hash).toMatch(/^[0-9a-f]{64}$/)
      expect(set['findings.$.lowQuality']).toBe(true)
      expect(set['findings.$.lowQualitySource']).toBe('ai')
      expect(db.fetches[0].body.messages[0].content).toContain('Answer in English')
    })

    it('sends the images only when the model reads them and the audit allows it', async () => {
      db.images["660000000000000000000aaa"] = png()
      db.audit.findings[0].observation = '<p>see</p><img src="660000000000000000000aaa" alt="Burp request"><img src="https://evil.test/x.png" alt="external">'
      await request(app).post(reviewUrl)
      expect(typeof db.fetches[0].body.messages[0].content).toBe('string')
      expect(db.fetches[0].body.messages[0].content).toContain('NOT attached')

      db.config.supportsImages = true
      db.audit.aiImagesAdvisor = true
      await request(app).post(reviewUrl)
      var content = db.fetches[1].body.messages[0].content
      expect(content.map(p => p.type)).toEqual(['text', 'text', 'image_url'])
      expect(content[1].text).toBe('Image 1 (Observation): Burp request')
      expect(content[2].image_url.url).toMatch(/^data:image\/png;base64,/)
    })

    it('needs the advisor enabled for the audit', async () => {
      db.audit.aiAdvisorEnabled = false
      var response = await request(app).post(reviewUrl)
      expect(response.status).toBe(403)
      expect(db.fetches.length).toBe(0)
    })

    it('keeps the flag a user lowered for the same content', async () => {
      await request(app).post(reviewUrl)
      var hash = db.auditUpdates[db.auditUpdates.length - 1]['findings.$.aiReview'].hash
      db.auditUpdates = []
      db.audit.findings[0].lowQualityDismissedHash = hash
      await request(app).post(reviewUrl)
      expect(db.auditUpdates[0]['findings.$.lowQuality']).toBeUndefined()
    })

    it('stores the error of the provider with the previous advice', async () => {
      db.audit.findings[0].aiReview = {verdict: 'ok', html: '<p>fine</p>', hash: 'x'}
      db.answer = {status: 500, body: {error: {message: 'boom'}}}
      var response = await request(app).post(reviewUrl)
      expect(response.status).toBe(502)
      var stored = db.auditUpdates[db.auditUpdates.length - 1]['findings.$.aiReview']
      expect(stored.html).toBe('<p>fine</p>')
      expect(stored.error).toContain('boom')
    })
  })

  describe('Observation with images', () => {
    it('attaches the images only for the Observation and when the audit allows it', async () => {
      db.images["660000000000000000000aaa"] = 'data:image/png;base64,' + (() => { var { PNG } = require('pngjs'); var p = new PNG({width: 2, height: 2}); return PNG.sync.write(p).toString('base64') })()
      db.config.supportsImages = true
      db.audit.aiImagesObservation = true
      var finding = {observation: '<p>x</p><img src="660000000000000000000aaa" alt="shot">'}
      await request(app).post(url).send({field: "description", finding})
      expect(typeof db.fetches[0].body.messages[0].content).toBe('string')
      var response = await request(app).post(url).send({field: "observation", finding})
      expect(response.body.datas.images).toBe(1)
      expect(db.fetches[1].body.messages[0].content[2].type).toBe('image_url')
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
