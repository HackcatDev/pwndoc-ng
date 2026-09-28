/*
 * Endpoint tests of the findings API with the models stubbed, so they run
 * without a database (npm run test:lib). tests/audit-api.test.js covers the
 * same API against MongoDB.
 */
module.exports = function () {
  var request = require("supertest")
  var express = require("express")
  var bodyParser = require("body-parser")
  var mongoose = require("mongoose")

  var AUDIT_ID = "660000000000000000000100"
  var OTHER_AUDIT_ID = "660000000000000000000200"
  var FINDING_ID = "660000000000000000000010"
  var KEY = "pwndoc_" + "a".repeat(64)

  var validCvss = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N"

  var customFields = [
    {_id: "660000000000000000000001", label: "Business_Impact", fieldType: "text", display: "finding", displaySub: "", position: 1},
  ]

  // State the stubbed models work on, reset before each test
  var db

  function makeApp() {
    var calls = []
    db.calls = calls

    var Audit = {
      getByApiKey: (key) => {
        calls.push(["getByApiKey", key])
        if (key !== KEY) return Promise.reject({fn: 'Unauthorized', message: 'Invalid API key'})
        return Promise.resolve({_id: AUDIT_ID, name: "Audit 1", auditType: "Web", language: "en", state: db.state})
      },
      getFindings: (isAdmin, auditId) => {
        calls.push(["getFindings", auditId])
        return Promise.resolve(db.findings)
      },
      getFinding: (isAdmin, auditId, userId, findingId) => {
        calls.push(["getFinding", auditId, String(findingId)])
        var finding = db.findings.find(f => String(f._id) === String(findingId))
        if (!finding) return Promise.reject({fn: 'NotFound', message: 'Finding not found'})
        return Promise.resolve(finding)
      },
      createFinding: (isAdmin, auditId, userId, finding) => {
        calls.push(["createFinding", auditId, finding])
        db.findings.push(Object.assign({identifier: db.findings.length + 1}, finding))
        return Promise.resolve("Audit Finding created successfully")
      },
      updateFinding: (isAdmin, auditId, userId, findingId, update) => {
        calls.push(["updateFinding", auditId, String(findingId), update])
        var finding = db.findings.find(f => String(f._id) === String(findingId))
        Object.keys(update).forEach(key => { finding[key] = update[key] })
        return Promise.resolve("Audit Finding updated successfully")
      },
      updateGeneral: (isAdmin, auditId, userId, update) => {
        calls.push(["updateGeneral", auditId, update])
        return Promise.resolve("ok")
      },
    }
    var models = {
      Audit: Audit,
      CustomField: {getAll: () => Promise.resolve(customFields)},
      Settings: {getAll: () => Promise.resolve(db.settings)},
    }

    var app = express()
    app.use(bodyParser.json({limit: '10mb'}))

    var realModel = mongoose.model
    mongoose.model = (name) => models[name] || realModel.call(mongoose, name)
    try {
      require("../src/routes/audit-api")(app, {to: () => ({emit: (event) => calls.push(["emit", event])})})
    } finally {
      mongoose.model = realModel
    }
    return app
  }

  var app

  beforeEach(() => {
    db = {
      state: "EDIT",
      settings: {reviews: {enabled: false, private: {removeApprovalsUponUpdate: false}}},
      findings: [{
        _id: FINDING_ID,
        identifier: 1,
        title: "SQL injection",
        cvssv3: validCvss,
        description: "<p>It is <strong>bad</strong>.</p>",
        observation: "<p>Kept as is.</p>",
        references: ["https://owasp.org"],
        status: 1,
        customFields: [{customField: customFields[0], text: "<p>Full access.</p>"}],
      }],
    }
    app = makeApp()
  })

  describe('Findings API authentication', () => {
    it('No key', async () => {
      var response = await request(app).get("/api/v1/findings")
      expect(response.status).toBe(401)
    })

    it('Unknown key', async () => {
      var response = await request(app).get("/api/v1/findings").set("X-API-Key", "pwndoc_unknown")
      expect(response.status).toBe(401)
      expect(response.body.datas).toEqual("Invalid API key")
    })

    it('Key as a bearer token', async () => {
      var response = await request(app).get("/api/v1/findings").set("Authorization", `Bearer ${KEY}`)
      expect(response.status).toBe(200)
    })

    it('The audit is the one the key belongs to', async () => {
      var response = await request(app).get("/api/v1/audit").set("X-API-Key", KEY)
      expect(response.status).toBe(200)
      expect(response.body.datas).toEqual({
        id: AUDIT_ID, name: "Audit 1", audit_type: "Web", language: "en", state: "EDIT",
      })
    })

    it('Every query is scoped to that audit', async () => {
      await request(app).get("/api/v1/findings").set("X-API-Key", KEY)
      await request(app).get(`/api/v1/findings/${FINDING_ID}`).set("X-API-Key", KEY)
      await request(app).patch(`/api/v1/findings/${FINDING_ID}`).set("X-API-Key", KEY).send({title: "x"})
      await request(app).post("/api/v1/findings").set("X-API-Key", KEY).send({title: "y", cvss_string: validCvss})

      var audited = db.calls.filter(c => ["getFindings", "getFinding", "createFinding", "updateFinding"].includes(c[0]))
      expect(audited.length).toBeGreaterThan(0)
      audited.forEach(call => expect(String(call[1])).toEqual(AUDIT_ID))
      expect(db.calls.some(c => String(c[1]) === OTHER_AUDIT_ID)).toBe(false)
    })
  })

  describe('Findings API list and read', () => {
    it('List holds the summary of each finding', async () => {
      var response = await request(app).get("/api/v1/findings").set("X-API-Key", KEY)
      expect(response.status).toBe(200)
      expect(response.body.datas).toEqual([{
        id: FINDING_ID,
        identifier: 1,
        title: "SQL injection",
        cvss_string: validCvss,
        cvss: {score: 7.5, severity: "High"},
        vuln_type: "",
        category: null,
        status: "redacting",
      }])
    })

    it('Read gives the rich text as Markdown', async () => {
      var response = await request(app).get(`/api/v1/findings/${FINDING_ID}`).set("X-API-Key", KEY)
      expect(response.status).toBe(200)
      expect(response.body.datas.description).toEqual("It is **bad**.")
      expect(response.body.datas.custom_fields).toEqual({business_impact: "Full access."})
      expect(response.body.datas.references).toEqual(["https://owasp.org"])
    })

    it('Unknown finding', async () => {
      var response = await request(app).get("/api/v1/findings/660000000000000000000999").set("X-API-Key", KEY)
      expect(response.status).toBe(404)
    })

    it('Malformed finding id', async () => {
      var response = await request(app).get("/api/v1/findings/not-an-id").set("X-API-Key", KEY)
      expect(response.status).toBe(404)
    })
  })

  describe('Findings API create', () => {
    it('Title and CVSS vector are required', async () => {
      var response = await request(app).post("/api/v1/findings").set("X-API-Key", KEY).send({description: "x"})
      expect(response.status).toBe(422)
      expect(response.body.datas).toEqual("title is required; cvss_string is required")
    })

    it('Creates a finding and answers with it', async () => {
      var response = await request(app).post("/api/v1/findings").set("X-API-Key", KEY).send({
        title: "Reflected XSS",
        cvss_string: validCvss,
        description: "A **script** runs.",
        affected_assets: "https://a.example.com",
        references: "- https://owasp.org/xss",
        business_impact: "Session theft.",
        status: "done",
      })

      expect(response.status).toBe(201)
      expect(response.body.datas.id).toMatch(/^[0-9a-f]{24}$/)
      expect(response.body.datas.title).toEqual("Reflected XSS")
      expect(response.body.datas.identifier).toEqual(2)
      expect(response.body.datas.description).toEqual("A **script** runs.")
      expect(response.body.datas.status).toEqual("done")
      expect(response.body.datas.custom_fields).toEqual({business_impact: "Session theft."})

      var created = db.findings[1]
      expect(created.description).toEqual("<p>A <strong>script</strong> runs.</p>")
      expect(created.references).toEqual(["https://owasp.org/xss"])
      expect(created.customFields[0].text).toEqual("<p>Session theft.</p>")
      expect(db.calls.some(c => c[0] === "emit" && c[1] === "updateAudit")).toBe(true)
    })

    it('Rejects an unknown field instead of dropping it', async () => {
      var response = await request(app).post("/api/v1/findings").set("X-API-Key", KEY)
        .send({title: "x", cvss_string: validCvss, severity: "High"})
      expect(response.status).toBe(422)
      expect(response.body.datas).toEqual("unknown field: severity")
    })
  })

  describe('Findings API update', () => {
    it('Updates only the fields of the request', async () => {
      var response = await request(app).patch(`/api/v1/findings/${FINDING_ID}`).set("X-API-Key", KEY)
        .send({remediation: "Use `parameters`."})

      expect(response.status).toBe(200)
      expect(db.findings[0].remediation).toEqual("<p>Use <code>parameters</code>.</p>")
      expect(db.findings[0].description).toEqual("<p>It is <strong>bad</strong>.</p>")
      expect(db.findings[0].observation).toEqual("<p>Kept as is.</p>")
      expect(db.findings[0].title).toEqual("SQL injection")
    })

    it('Updating one custom field keeps the others', async () => {
      db.findings[0].customFields.push({customField: {_id: "660000000000000000000002", label: "Access_Level", fieldType: "input"}, text: "user"})

      var response = await request(app).patch(`/api/v1/findings/${FINDING_ID}`).set("X-API-Key", KEY)
        .send({business_impact: "Updated impact."})

      expect(response.status).toBe(200)
      expect(db.findings[0].customFields[0].text).toEqual("<p>Updated impact.</p>")
      expect(db.findings[0].customFields[1].text).toEqual("user")
    })

    it('PUT behaves like PATCH', async () => {
      var response = await request(app).put(`/api/v1/findings/${FINDING_ID}`).set("X-API-Key", KEY).send({title: "Renamed"})
      expect(response.status).toBe(200)
      expect(db.findings[0].title).toEqual("Renamed")
      expect(db.findings[0].description).toEqual("<p>It is <strong>bad</strong>.</p>")
    })

    it('An empty body is refused', async () => {
      var response = await request(app).patch(`/api/v1/findings/${FINDING_ID}`).set("X-API-Key", KEY).send({})
      expect(response.status).toBe(422)
      expect(response.body.datas).toEqual("No field to update")
    })

    it('Unknown finding', async () => {
      var response = await request(app).patch("/api/v1/findings/660000000000000000000999").set("X-API-Key", KEY).send({title: "x"})
      expect(response.status).toBe(404)
    })
  })

  describe('Findings API and the review state', () => {
    it('Writing is refused when reviews are enabled and the audit is not in EDIT', async () => {
      db.settings.reviews.enabled = true
      db.state = "APPROVED"
      app = makeApp()

      var create = await request(app).post("/api/v1/findings").set("X-API-Key", KEY).send({title: "x", cvss_string: validCvss})
      expect(create.status).toBe(403)

      var update = await request(app).patch(`/api/v1/findings/${FINDING_ID}`).set("X-API-Key", KEY).send({title: "x"})
      expect(update.status).toBe(403)

      var read = await request(app).get(`/api/v1/findings/${FINDING_ID}`).set("X-API-Key", KEY)
      expect(read.status).toBe(200)
    })

    it('Approvals are removed on update when the settings ask for it', async () => {
      db.settings.reviews.enabled = true
      db.settings.reviews.private.removeApprovalsUponUpdate = true
      app = makeApp()

      await request(app).patch(`/api/v1/findings/${FINDING_ID}`).set("X-API-Key", KEY).send({title: "x"})
      expect(db.calls.some(c => c[0] === "updateGeneral" && JSON.stringify(c[2]) === '{"approvals":[]}')).toBe(true)
    })
  })
}
