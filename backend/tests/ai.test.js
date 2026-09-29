/*
 * AI assistant: prompts, placeholders, provider requests and answers
 * (lib/ai.js), without a database nor a network.
 */
module.exports = function () {
  var ai = require("../src/lib/ai")

  var customFields = [
    {_id: "c1", label: "Business_Impact", fieldType: "text", display: "finding"},
    {_id: "c2", label: "Access_Level", fieldType: "select", display: "finding"},
    {_id: "c3", label: "Client note", fieldType: "text", display: "audit"},
  ]
  var audit = {
    name: "Web app Q3", auditType: "Web", language: "en",
    company: {name: "ACME"}, client: {firstname: "Jane", lastname: "Doe"},
    scope: [{name: "app.acme.test"}, {name: "api.acme.test"}],
    date_start: "2026-09-01", date_end: "2026-09-10",
  }
  var finding = {
    title: "SQL injection",
    description: "<p>It is <strong>bad</strong>.</p>",
    observation: "<ul><li><p>one</p></li></ul>",
    references: ["https://owasp.org", "https://cwe.mitre.org/data/definitions/89.html"],
    scope: "<p>app.acme.test</p>",
    remediation: "",
    cvssv3: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
    priority: 3, remediationComplexity: 1,
    customFields: [
      {customField: {label: "Business_Impact", fieldType: "text"}, text: "<p>Data <em>leak</em></p>"},
      {customField: {label: "Access_Level", fieldType: "select"}, text: "Admin"},
    ],
  }
  var languages = [{language: "English", locale: "en"}]

  describe('AI fields and prompts', () => {
    it('Fields: built-in ones then rich text custom fields of findings', () => {
      var keys = ai.availableFields(customFields).map(f => f.key)
      expect(keys).toEqual(["title", "description", "observation", "references", "remediation", "business_impact"])
    })

    it('Prompt: audit override, then global, then default', () => {
      expect(ai.selectPrompt("title", {title: "A"}, {title: "G"})).toBe("A")
      expect(ai.selectPrompt("title", {title: "  "}, {title: "G"})).toBe("G")
      expect(ai.selectPrompt("title", {}, {})).toBe(ai.defaultPrompt("title"))
      expect(ai.defaultPrompt("business_impact")).toContain("{business_impact}")
    })

    it('Placeholder values', () => {
      var v = ai.buildValues({audit, finding, fieldKey: "business_impact", languages, customFields})
      expect(v.company_name).toBe("ACME")
      expect(v.client_name).toBe("Jane Doe")
      expect(v.report_language).toBe("English")
      expect(v.report_locale).toBe("en")
      expect(v.audit_scope).toBe("app.acme.test\napi.acme.test")
      expect(v.description).toBe("It is **bad**.")
      expect(v.observation).toMatch(/^[-*] one$/)
      expect(v.references).toBe("https://owasp.org\nhttps://cwe.mitre.org/data/definitions/89.html")
      expect(v.affected_assets).toBe("app.acme.test")
      expect(v.cvss_score).toBe("7.5")
      expect(v.cvss_severity).toBe("High")
      expect(v.priority).toBe("High")
      expect(v.remediation_complexity).toBe("Easy")
      expect(v.business_impact).toBe("Data *leak*")
      expect(v.access_level).toBe("Admin")
      expect(v.selected_field).toBe("business_impact")
      expect(v.selected_field_label).toBe("Business_Impact")
      expect(v.current_value).toBe("Data *leak*")
    })

    it('A custom field without a value is an empty placeholder', () => {
      var v = ai.buildValues({audit, finding: {title: "x"}, fieldKey: "title", languages, customFields})
      expect(v.business_impact).toBe("")
      expect(v.current_value).toBe("x")
    })

    it('Rendering leaves unknown placeholders and JSON braces alone', () => {
      expect(ai.render("{title} {unknown} {\"a\": 1}", {title: "T"})).toBe("T {unknown} {\"a\": 1}")
      expect(ai.unknownPlaceholders("{title} {nope} {x_y}", ["title"])).toEqual(["nope", "x_y"])
    })
  })

  describe('AI provider requests', () => {
    it('OpenAI style', () => {
      var r = ai.buildRequest({provider: "openai", apiHost: "https://api.openai.com/v1/", apiKey: "k", model: "m", systemPrompt: "S", temperature: 0.2, maxTokens: 100, extraBody: '{"reasoning_effort":"low"}'}, "P")
      expect(r.url).toBe("https://api.openai.com/v1/chat/completions")
      expect(r.headers.Authorization).toBe("Bearer k")
      expect(r.body).toEqual({model: "m", messages: [{role: "system", content: "S"}, {role: "user", content: "P"}], max_tokens: 100, temperature: 0.2, reasoning_effort: "low"})
    })

    it('OpenAI style without a key nor optional parameters (local server)', () => {
      var r = ai.buildRequest({provider: "openai", apiHost: "http://host.docker.internal:11434/v1", model: "llama3"}, "P")
      expect(r.headers.Authorization).toBeUndefined()
      expect(r.body).toEqual({model: "llama3", messages: [{role: "user", content: "P"}]})
    })

    it('Anthropic style', () => {
      var r = ai.buildRequest({provider: "anthropic", apiHost: "https://api.anthropic.com", apiKey: "k", model: "claude", systemPrompt: "S"}, "P")
      expect(r.url).toBe("https://api.anthropic.com/v1/messages")
      expect(r.headers["x-api-key"]).toBe("k")
      expect(r.headers["anthropic-version"]).toBe("2023-06-01")
      expect(r.body).toEqual({model: "claude", max_tokens: 4096, system: "S", messages: [{role: "user", content: "P"}]})
      expect(ai.buildRequest({provider: "anthropic", apiHost: "https://x/v1", model: "m"}, "P").url).toBe("https://x/v1/messages")
    })

    it('Not configured', () => {
      expect(() => ai.buildRequest({provider: "openai", model: "m"}, "P")).toThrow(/API host/)
      expect(() => ai.buildRequest({provider: "openai", apiHost: "https://x"}, "P")).toThrow(/model/)
    })
  })

  function fakeFetch(status, body, calls) {
    return async (url, options) => {
      if (calls) calls.push({url, options})
      return {ok: status >= 200 && status < 300, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body)}
    }
  }

  describe('AI answers and errors', () => {
    var openai = {provider: "openai", apiHost: "https://x/v1", apiKey: "k", model: "m"}

    it('OpenAI answer', async () => {
      var calls = []
      var text = await ai.complete(openai, "P", {fetchImpl: fakeFetch(200, {choices: [{message: {content: "Hello"}}]}, calls)})
      expect(text).toBe("Hello")
      expect(JSON.parse(calls[0].options.body).messages[0].content).toBe("P")
    })

    it('Anthropic answer', async () => {
      var text = await ai.complete({provider: "anthropic", apiHost: "https://x", model: "m"}, "P", {fetchImpl: fakeFetch(200, {content: [{type: "text", text: "Hi"}, {type: "text", text: "!"}]})})
      expect(text).toBe("Hi!")
    })

    it('A refused key is a 502 with the message of the provider, never a 401', async () => {
      await expect(ai.complete(openai, "P", {fetchImpl: fakeFetch(401, {error: {message: "Incorrect API key"}})}))
        .rejects.toMatchObject({status: 502, message: "The API key was refused by the model provider: Incorrect API key"})
    })

    it('Rate limit, unknown model, empty answer, not JSON', async () => {
      await expect(ai.complete(openai, "P", {fetchImpl: fakeFetch(429, {error: {message: "slow down"}})})).rejects.toThrow(/Rate limit.*slow down/)
      await expect(ai.complete(openai, "P", {fetchImpl: fakeFetch(404, "nope")})).rejects.toThrow(/Model or endpoint not found.*: nope/)
      await expect(ai.complete(openai, "P", {fetchImpl: fakeFetch(200, {choices: [{message: {content: ""}, finish_reason: "length"}]})})).rejects.toThrow(/empty answer \(length\)/)
      await expect(ai.complete(openai, "P", {fetchImpl: fakeFetch(200, "<html>")})).rejects.toThrow(/did not answer JSON/)
    })

    it('Unreachable host and timeout', async () => {
      var down = async () => { var e = new TypeError("fetch failed"); e.cause = {code: "ECONNREFUSED"}; throw e }
      await expect(ai.complete(openai, "P", {fetchImpl: down})).rejects.toMatchObject({status: 502, message: "Cannot reach the model at https://x/v1/chat/completions (ECONNREFUSED)"})
      var slow = async () => { var e = new Error("t"); e.name = "TimeoutError"; throw e }
      await expect(ai.complete(Object.assign({timeout: 30}, openai), "P", {fetchImpl: slow})).rejects.toMatchObject({status: 504, message: "The model did not answer within 30 seconds"})
    })

    it('Answer to field value', () => {
      expect(ai.toFieldValue("text", '"SQL injection in login"\n')).toBe("SQL injection in login")
      expect(ai.toFieldValue("text", "# **Title**")).toBe("Title")
      expect(ai.toFieldValue("lines", "- https://a\n2. https://b\n\n* OWASP https://c")).toEqual(["https://a", "https://b", "OWASP https://c"])
      expect(ai.toFieldValue("html", "```markdown\nSome **bold**\n```")).toBe("<p>Some <strong>bold</strong></p>")
      expect(ai.toFieldValue("html", "<think>hmm</think>\nText")).toBe("<p>Text</p>")
      expect(ai.toFieldValue("html", "Hi <script>alert(1)</script>")).not.toContain("script")
    })

    it('Whole generation uses the audit prompt with its placeholders', async () => {
      var calls = []
      var result = await ai.generate({
        config: Object.assign({prompts: {remediation: "global"}}, openai),
        audit: Object.assign({aiPrompts: {remediation: "Fix {title} for {company_name}, now: {current_value}"}}, audit),
        finding, fieldKey: "remediation", languages, customFields,
        fetchImpl: fakeFetch(200, {choices: [{message: {content: "1. Use prepared statements"}}]}, calls),
      })
      expect(JSON.parse(calls[0].options.body).messages[0].content).toBe("Fix SQL injection for ACME, now: ")
      expect(result).toEqual({field: "remediation", kind: "html", value: "<ol>\n<li><p>Use prepared statements</p></li>\n</ol>", model: "m"})
    })

    it('Unknown field', async () => {
      await expect(ai.generate({config: openai, audit, finding, fieldKey: "poc", languages, customFields})).rejects.toMatchObject({status: 422})
    })
  })

  describe('AI configuration updates', () => {
    it('Valid update, key kept when empty', () => {
      var r = ai.parseConfigUpdate({provider: "anthropic", apiHost: " https://api.anthropic.com ", apiKey: "", model: "m", temperature: "0.5", maxTokens: "", timeout: 60, extraBody: "", prompts: {title: "T", description: "", "bad key": "x"}})
      expect(r.errors).toEqual(["invalid prompt key: bad key"])
      expect(r.update).toEqual({provider: "anthropic", apiHost: "https://api.anthropic.com", model: "m", temperature: 0.5, maxTokens: null, timeout: 60, extraBody: "", prompts: {title: "T"}})
    })

    it('New key, cleared key, invalid values', () => {
      expect(ai.parseConfigUpdate({apiKey: " sk-1 "}).update.apiKey).toBe("sk-1")
      expect(ai.parseConfigUpdate({apiKey: "sk-1", clearApiKey: true}).update.apiKey).toBe("")
      var r = ai.parseConfigUpdate({provider: "x", apiHost: "ftp://a", temperature: 3, extraBody: "{", prompts: []})
      expect(r.errors).toEqual(["provider must be openai or anthropic", "apiHost must be an http(s) URL", "temperature must be between 0 and 2", "extraBody is not valid JSON", "prompts must be an object"])
    })
  })
}
