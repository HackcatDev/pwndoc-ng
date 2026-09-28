module.exports = function () {
  var findingApi = require("../src/lib/finding-api")

  // Custom fields as the deployment defines them: a rich text "Business_Impact"
  // on findings, a plain "Access_Level" on vulnerabilities (findings inherit
  // those) and one that belongs to the audit, not to a finding.
  var customFields = [
    {_id: "660000000000000000000001", label: "Business_Impact", fieldType: "text", display: "finding", displaySub: "", position: 1},
    {_id: "660000000000000000000002", label: "Access_Level", fieldType: "input", display: "vulnerability", displaySub: "", position: 2},
    {_id: "660000000000000000000003", label: "Audit Note", fieldType: "text", display: "general", displaySub: "", position: 3},
  ]

  var validCvss = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N"

  describe('Findings API field mapping', () => {
    it('Create requires a title and a CVSS vector', () => {
      var parsed = findingApi.parse({}, customFields, {partial: false})
      expect(parsed.errors).toEqual(["title is required", "cvss_string is required"])
    })

    it('Create maps the documented fields', () => {
      var parsed = findingApi.parse({
        title: " SQL injection ",
        cvss_string: validCvss,
        description: "It is **bad**.",
        observation: "Seen in prod.",
        remediation: "Use `parameters`.",
        affected_assets: "- https://a.example.com\n- https://b.example.com",
        references: "- https://cwe.mitre.org/data/definitions/89.html\n- https://owasp.org",
      }, customFields, {partial: false})

      expect(parsed.errors).toEqual([])
      expect(parsed.finding).toEqual({
        title: "SQL injection",
        cvssv3: validCvss,
        description: "<p>It is <strong>bad</strong>.</p>",
        observation: "<p>Seen in prod.</p>",
        remediation: "<p>Use <code>parameters</code>.</p>",
        // GFM turns a bare URL into a link, which the report keeps as a hyperlink
        scope: '<ul>\n<li><p><a href="https://a.example.com">https://a.example.com</a></p></li>\n<li><p><a href="https://b.example.com">https://b.example.com</a></p></li>\n</ul>',
        references: ["https://cwe.mitre.org/data/definitions/89.html", "https://owasp.org"],
      })
      expect(parsed.customFields).toEqual([])
    })

    it('Rejects an invalid CVSS vector', () => {
      var parsed = findingApi.parse({title: "x", cvss_string: "AV:N/AC:L"}, customFields, {partial: false})
      expect(parsed.errors).toEqual(["cvss_string is not a valid CVSS 3.x vector (MalformedVectorString)"])
    })

    it('Rejects unknown fields', () => {
      var parsed = findingApi.parse({title: "x", cvss_string: validCvss, cvss: 7.5, bogus: 1}, customFields, {partial: false})
      expect(parsed.errors).toEqual(["unknown field: cvss", "unknown field: bogus"])
    })

    it('Validates the enum fields and the status', () => {
      var parsed = findingApi.parse({priority: 9, remediation_complexity: 2, status: "closed"}, customFields, {partial: true})
      expect(parsed.errors).toEqual(["priority must be one of 1, 2, 3, 4", 'status must be "done" or "redacting"'])
      expect(parsed.finding).toEqual({remediationComplexity: 2})

      var ok = findingApi.parse({status: "done", priority: 4}, customFields, {partial: true})
      expect(ok.errors).toEqual([])
      expect(ok.finding).toEqual({status: 0, priority: 4})
    })

    it('Update keeps the fields that are not part of the request', () => {
      var parsed = findingApi.parse({remediation: "Patch it."}, customFields, {partial: true})
      expect(parsed.errors).toEqual([])
      expect(Object.keys(parsed.finding)).toEqual(["remediation"])
    })

    it('Update can clear a rich text field with an empty string', () => {
      var parsed = findingApi.parse({observation: ""}, customFields, {partial: true})
      expect(parsed.finding).toEqual({observation: ""})
    })

    it('Custom fields are addressed by slug, at the top level or in custom_fields', () => {
      var top = findingApi.parse({business_impact: "Full **database** access."}, customFields, {partial: true})
      expect(top.errors).toEqual([])
      expect(top.finding).toEqual({})
      expect(top.customFields).toEqual([{
        slug: "business_impact",
        field: customFields[0],
        value: "<p>Full <strong>database</strong> access.</p>",
      }])

      var nested = findingApi.parse({custom_fields: {Access_Level: "admin"}}, customFields, {partial: true})
      expect(nested.errors).toEqual([])
      expect(nested.customFields).toEqual([{slug: "access_level", field: customFields[1], value: "admin"}])
    })

    it('Custom fields of the audit are not fields of a finding', () => {
      var parsed = findingApi.parse({custom_fields: {"Audit Note": "x"}}, customFields, {partial: true})
      expect(parsed.errors).toEqual(["unknown custom field: Audit Note"])
    })

    it('Merging custom fields leaves the other values untouched', () => {
      var existing = [
        {customField: {_id: "660000000000000000000001", label: "Business_Impact", fieldType: "text"}, text: "<p>old</p>"},
        {customField: {_id: "660000000000000000000002", label: "Access_Level", fieldType: "input"}, text: "user"},
      ]
      var parsed = findingApi.parse({business_impact: "new"}, customFields, {partial: true})
      var merged = findingApi.mergeCustomFields(existing, parsed.customFields)

      expect(merged).toHaveLength(2)
      expect(merged[0].text).toEqual("<p>new</p>")
      expect(merged[1].text).toEqual("user")
    })

    it('Merging adds a custom field the finding did not hold yet', () => {
      var parsed = findingApi.parse({business_impact: "new"}, customFields, {partial: true})
      var merged = findingApi.mergeCustomFields([], parsed.customFields)

      expect(merged).toHaveLength(1)
      expect(merged[0].text).toEqual("<p>new</p>")
      expect(merged[0].customField.label).toEqual("Business_Impact")
      expect(merged[0].customField.text).toBeUndefined() // the default value is not copied
    })
  })

  describe('Findings API serialization', () => {
    var finding = {
      _id: "660000000000000000000010",
      identifier: 3,
      title: "SQL injection",
      cvssv3: validCvss,
      vulnType: "Web",
      category: "Web",
      status: 0,
      priority: 3,
      remediationComplexity: 1,
      description: "<p>It is <strong>bad</strong>.</p>",
      observation: "",
      poc: '<pre><code class="language-http">GET / HTTP/1.1</code></pre>',
      scope: "<p>https://a.example.com</p>",
      remediation: "<p>Use <code>parameters</code>.</p>",
      references: ["https://owasp.org"],
      customFields: [
        {customField: {_id: "660000000000000000000001", label: "Business_Impact", fieldType: "text"}, text: "<p>Full access.</p>"},
      ],
    }

    it('Rich text comes back as Markdown, with the CVSS score', () => {
      var out = findingApi.serialize(finding, customFields)
      expect(out).toEqual({
        id: "660000000000000000000010",
        identifier: 3,
        title: "SQL injection",
        cvss_string: validCvss,
        cvss: {score: 7.5, severity: "High"},
        vuln_type: "Web",
        category: "Web",
        status: "done",
        priority: 3,
        remediation_complexity: 1,
        description: "It is **bad**.",
        observation: "",
        poc: "```http\nGET / HTTP/1.1\n```",
        affected_assets: "https://a.example.com",
        remediation: "Use `parameters`.",
        references: ["https://owasp.org"],
        custom_fields: {business_impact: "Full access.", access_level: null},
      })
    })

    it('An invalid or missing vector does not break the answer', () => {
      var out = findingApi.serialize({_id: "660000000000000000000011", title: "x", cvssv3: ""}, [])
      expect(out.cvss).toEqual({score: null, severity: "None"})
      expect(out.status).toEqual("redacting")
    })

    it('The list holds no bodies', () => {
      var out = findingApi.serializeSummary(finding)
      expect(out).toEqual({
        id: "660000000000000000000010",
        identifier: 3,
        title: "SQL injection",
        cvss_string: validCvss,
        cvss: {score: 7.5, severity: "High"},
        vuln_type: "Web",
        category: "Web",
        status: "done",
      })
    })
  })
}
