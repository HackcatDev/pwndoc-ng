/*
  Findings API against the database: the key really identifies one audit and
  cannot reach anything else. The field mapping itself is covered without a
  database by finding-api.test.js and audit-api-routes.test.js.
*/

module.exports = function (request, app) {
  describe("Findings API Suite Tests", () => {
    var userToken = "";
    var auditAId = "";
    var auditBId = "";
    var keyA = "";
    var keyB = "";
    var findingAId = "";
    var findingBId = "";

    var validCvss = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N";

    beforeAll(async () => {
      var response = await request(app)
        .post("/api/users/token")
        .send({ username: "admin", password: "Admin123" });
      userToken = response.body.datas.token;

      response = await request(app)
        .post("/api/audits")
        .set("Cookie", [`token=JWT ${userToken}`])
        .send({ name: "API Audit A", language: "en", auditType: "Web" });
      auditAId = response.body.datas.audit._id;

      response = await request(app)
        .post("/api/audits")
        .set("Cookie", [`token=JWT ${userToken}`])
        .send({ name: "API Audit B", language: "en", auditType: "Web" });
      auditBId = response.body.datas.audit._id;

      // a finding of audit B, created through the web interface API
      await request(app)
        .post(`/api/audits/${auditBId}/findings`)
        .set("Cookie", [`token=JWT ${userToken}`])
        .send({ title: "Finding of B", cvssv3: validCvss });

      response = await request(app)
        .get(`/api/audits/${auditBId}`)
        .set("Cookie", [`token=JWT ${userToken}`]);
      findingBId = response.body.datas.findings[0]._id;

      // a custom field on findings, addressed by its slug in the API
      await request(app)
        .post("/api/data/custom-fields")
        .set("Cookie", [`token=JWT ${userToken}`])
        .send({ fieldType: "text", label: "Business_Impact", display: "finding" });
    });

    describe("API key management", () => {
      it("An audit has no key until one is generated", async () => {
        var response = await request(app)
          .get(`/api/audits/${auditAId}/apikey`)
          .set("Cookie", [`token=JWT ${userToken}`]);

        expect(response.status).toBe(200);
        expect(response.body.datas.apiKey).toBeNull();
      });

      it("Generate a key", async () => {
        var response = await request(app)
          .post(`/api/audits/${auditAId}/apikey`)
          .set("Cookie", [`token=JWT ${userToken}`]);

        expect(response.status).toBe(200);
        expect(response.body.datas.apiKey).toMatch(/^pwndoc_[0-9a-f]{64}$/);
        keyA = response.body.datas.apiKey;

        response = await request(app)
          .post(`/api/audits/${auditBId}/apikey`)
          .set("Cookie", [`token=JWT ${userToken}`]);
        keyB = response.body.datas.apiKey;
        expect(keyB).not.toEqual(keyA);
      });

      it("Read the key back", async () => {
        var response = await request(app)
          .get(`/api/audits/${auditAId}/apikey`)
          .set("Cookie", [`token=JWT ${userToken}`]);

        expect(response.status).toBe(200);
        expect(response.body.datas.apiKey).toEqual(keyA);
        expect(response.body.datas.apiKeyCreatedAt).not.toBeNull();
      });

      it("The key is not part of the audit or of its general information", async () => {
        var response = await request(app)
          .get(`/api/audits/${auditAId}/general`)
          .set("Cookie", [`token=JWT ${userToken}`]);
        expect(response.body.datas.apiKey).toBeUndefined();

        response = await request(app)
          .get(`/api/audits/${auditAId}`)
          .set("Cookie", [`token=JWT ${userToken}`]);
        expect(response.body.datas.apiKey).toBeUndefined();
      });

      it("Reading the key requires authentication", async () => {
        var response = await request(app).get(`/api/audits/${auditAId}/apikey`);
        expect(response.status).toBe(401);
      });
    });

    describe("Findings API authentication", () => {
      it("No key", async () => {
        var response = await request(app).get("/api/v1/findings");
        expect(response.status).toBe(401);
      });

      it("Unknown key", async () => {
        var response = await request(app).get("/api/v1/findings").set("X-API-Key", `pwndoc_${"0".repeat(64)}`);
        expect(response.status).toBe(401);
      });

      it("The key identifies its audit", async () => {
        var response = await request(app).get("/api/v1/audit").set("X-API-Key", keyA);

        expect(response.status).toBe(200);
        expect(response.body.datas.id).toEqual(auditAId);
        expect(response.body.datas.name).toEqual("API Audit A");
      });
    });

    describe("Findings API create, read and update", () => {
      it("Create a finding", async () => {
        var response = await request(app)
          .post("/api/v1/findings")
          .set("X-API-Key", keyA)
          .send({
            title: "SQL injection",
            cvss_string: validCvss,
            description: "The endpoint `/api/users` is vulnerable to **SQL injection**.",
            observation: "Exploited from an unauthenticated session.",
            remediation: "Use prepared statements.",
            affected_assets: "- https://a.example.com/api/users",
            references: "- https://cwe.mitre.org/data/definitions/89.html",
            business_impact: "Full read access to the **customer** database.",
          });

        expect(response.status).toBe(201);
        expect(response.body.datas.id).toMatch(/^[0-9a-f]{24}$/);
        expect(response.body.datas.identifier).toEqual(1);
        expect(response.body.datas.cvss).toEqual({ score: 7.5, severity: "High" });
        expect(response.body.datas.custom_fields.business_impact).toEqual("Full read access to the **customer** database.");
        findingAId = response.body.datas.id;
      });

      it("The finding is stored as editor HTML", async () => {
        var response = await request(app)
          .get(`/api/audits/${auditAId}/findings/${findingAId}`)
          .set("Cookie", [`token=JWT ${userToken}`]);

        expect(response.status).toBe(200);
        expect(response.body.datas.description).toEqual("<p>The endpoint <code>/api/users</code> is vulnerable to <strong>SQL injection</strong>.</p>");
        expect(response.body.datas.scope).toContain("<li><p>");
        expect(response.body.datas.references).toEqual(["https://cwe.mitre.org/data/definitions/89.html"]);
      });

      it("Create without a title or a CVSS vector", async () => {
        var response = await request(app).post("/api/v1/findings").set("X-API-Key", keyA).send({ description: "x" });
        expect(response.status).toBe(422);
      });

      it("Create with an invalid CVSS vector", async () => {
        var response = await request(app)
          .post("/api/v1/findings")
          .set("X-API-Key", keyA)
          .send({ title: "x", cvss_string: "CVSS:3.1/AV:Z" });
        expect(response.status).toBe(422);
      });

      it("Read a finding", async () => {
        var response = await request(app).get(`/api/v1/findings/${findingAId}`).set("X-API-Key", keyA);

        expect(response.status).toBe(200);
        expect(response.body.datas.title).toEqual("SQL injection");
        expect(response.body.datas.description).toEqual("The endpoint `/api/users` is vulnerable to **SQL injection**.");
        expect(response.body.datas.remediation).toEqual("Use prepared statements.");
      });

      it("List the findings of the audit", async () => {
        var response = await request(app).get("/api/v1/findings").set("X-API-Key", keyA);

        expect(response.status).toBe(200);
        expect(response.body.datas).toHaveLength(1);
        expect(response.body.datas[0].id).toEqual(findingAId);
        expect(response.body.datas[0].description).toBeUndefined();
      });

      it("Update one field, leaving the others untouched", async () => {
        var response = await request(app)
          .patch(`/api/v1/findings/${findingAId}`)
          .set("X-API-Key", keyA)
          .send({ remediation: "Use prepared statements *everywhere*." });

        expect(response.status).toBe(200);
        expect(response.body.datas.remediation).toEqual("Use prepared statements *everywhere*.");
        expect(response.body.datas.description).toEqual("The endpoint `/api/users` is vulnerable to **SQL injection**.");
        expect(response.body.datas.custom_fields.business_impact).toEqual("Full read access to the **customer** database.");
      });

      it("Update a custom field, leaving the rest of the finding untouched", async () => {
        var response = await request(app)
          .patch(`/api/v1/findings/${findingAId}`)
          .set("X-API-Key", keyA)
          .send({ business_impact: "Full access, including **write**." });

        expect(response.status).toBe(200);
        expect(response.body.datas.custom_fields.business_impact).toEqual("Full access, including **write**.");
        expect(response.body.datas.title).toEqual("SQL injection");
      });

      it("Update with an unknown field", async () => {
        var response = await request(app)
          .patch(`/api/v1/findings/${findingAId}`)
          .set("X-API-Key", keyA)
          .send({ severity: "High" });
        expect(response.status).toBe(422);
      });

      it("Update with nothing to change", async () => {
        var response = await request(app).patch(`/api/v1/findings/${findingAId}`).set("X-API-Key", keyA).send({});
        expect(response.status).toBe(422);
      });
    });

    describe("Findings API isolation between audits", () => {
      it("A key does not list the findings of another audit", async () => {
        var response = await request(app).get("/api/v1/findings").set("X-API-Key", keyA);
        expect(response.body.datas.map((f) => f.id)).not.toContain(findingBId);

        response = await request(app).get("/api/v1/findings").set("X-API-Key", keyB);
        expect(response.body.datas.map((f) => f.id)).toEqual([findingBId]);
      });

      it("A key cannot read a finding of another audit", async () => {
        var response = await request(app).get(`/api/v1/findings/${findingBId}`).set("X-API-Key", keyA);
        expect(response.status).toBe(404);
      });

      it("A key cannot update a finding of another audit", async () => {
        var response = await request(app)
          .patch(`/api/v1/findings/${findingBId}`)
          .set("X-API-Key", keyA)
          .send({ title: "Hijacked" });
        expect(response.status).toBe(404);

        // and the finding is untouched
        var check = await request(app)
          .get(`/api/audits/${auditBId}/findings/${findingBId}`)
          .set("Cookie", [`token=JWT ${userToken}`]);
        expect(check.body.datas.title).toEqual("Finding of B");
      });

      it("A finding created with a key belongs to that audit only", async () => {
        var response = await request(app)
          .post("/api/v1/findings")
          .set("X-API-Key", keyB)
          .send({ title: "Second finding of B", cvss_string: validCvss });
        expect(response.status).toBe(201);

        var listA = await request(app).get("/api/v1/findings").set("X-API-Key", keyA);
        expect(listA.body.datas.map((f) => f.title)).not.toContain("Second finding of B");
      });
    });

    describe("Findings API key rotation", () => {
      it("Generating a new key revokes the previous one", async () => {
        var response = await request(app)
          .post(`/api/audits/${auditAId}/apikey`)
          .set("Cookie", [`token=JWT ${userToken}`]);
        expect(response.status).toBe(200);

        var newKey = response.body.datas.apiKey;
        expect(newKey).not.toEqual(keyA);

        var withOldKey = await request(app).get("/api/v1/findings").set("X-API-Key", keyA);
        expect(withOldKey.status).toBe(401);

        var withNewKey = await request(app).get("/api/v1/findings").set("X-API-Key", newKey);
        expect(withNewKey.status).toBe(200);
        keyA = newKey;
      });
    });
  });
};
