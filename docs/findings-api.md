# Findings API

An API to create and edit the findings of **one** audit from outside the web
interface: a script, a scanner import, or an MCP server exposing the endpoints
below as tools.

Every request authenticates with a key that belongs to a single audit, which is
why no request ever carries an audit id: a key cannot read or write anything
outside of its own audit.

## Getting a key

Open the audit, go to **General Information**, and use **Generate** in the
*Findings API key* section. The key is shown there afterwards (hidden behind the
eye icon, with a copy button), so it can be read again at any time by anyone
allowed to edit the audit.

**Regenerate** replaces the key: the previous one stops working immediately, so
it is also how a key is revoked when it leaked or when a client no longer needs
access. Deleting the audit removes its key too, and a cloned audit starts
without one.

A key is a long random string prefixed with `pwndoc_`. It grants write access to
the findings of its audit, so it belongs in a secret store, not in a repository.

## Authentication

Send the key in the `X-API-Key` header:

```
X-API-Key: pwndoc_0123456789abcdef...
```

`Authorization: Bearer pwndoc_...` is accepted as well, for clients that only
handle bearer tokens.

A missing or unknown key is answered with `401`.

## Endpoints

All answers use the envelope of the rest of the API, `{"status": ..., "datas": ...}`,
and `datas` holds a string with the reason when something went wrong.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/audit` | the audit the key belongs to |
| `GET` | `/api/v1/findings` | list the findings of that audit |
| `POST` | `/api/v1/findings` | create a finding, answers with it (`201`) |
| `GET` | `/api/v1/findings/<id>` | read one finding |
| `PATCH` | `/api/v1/findings/<id>` | update the given fields of a finding |

`PUT` is accepted on a finding as well and behaves exactly like `PATCH`.
Findings cannot be deleted through this API.

### Fields

Every field is optional except `title` and `cvss_string`, which are required
when creating a finding. Sending an unknown field is an error (`422`) rather
than silently ignored, so a typo cannot quietly drop content.

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | plain text |
| `cvss_string` | string | CVSS 3.x vector, validated (`CVSS:3.1/AV:N/...`) |
| `description` | Markdown | |
| `observation` | Markdown | |
| `poc` | Markdown | proof of concept |
| `affected_assets` | Markdown | the finding's *Affected scope* |
| `remediation` | Markdown | |
| `references` | array of strings, or Markdown list | one entry per line, list markers are removed |
| `vuln_type` | string | must match a vulnerability type of the deployment to be translated in the report |
| `category` | string | drives the sorting of the findings |
| `priority` | 1 to 4 | low, medium, high, urgent |
| `remediation_complexity` | 1 to 3 | easy, medium, complex |
| `status` | `"redacting"` or `"done"` | |
| `custom_fields` | object | custom fields by name, see below |

A finding's **custom fields** are addressed by the same name the docx template
uses: the label lowercased, without spaces, with anything but a letter, a digit
or an underscore replaced by an underscore. A field labelled `Business_Impact`
is therefore `business_impact`, and can be given either at the top level or
inside `custom_fields`:

```json
{ "business_impact": "Full read access to the customer database." }
{ "custom_fields": { "business_impact": "Full read access to the customer database." } }
```

Rich text custom fields take Markdown, the others take their plain value (a
string, or an array for checkboxes and multiple selects). Custom fields that
belong to the audit rather than to a finding are rejected.

### Markdown

The editor stores HTML, the API speaks Markdown, and the conversion happens on
the way in and on the way out. Headings, bold, italic, inline code, fenced code
blocks with their language, lists, tables, quotes, links and images are all
supported; a single newline becomes a line break, as in the editor.

Two things are worth knowing:

- Formatting Markdown has no syntax for (underline, highlight, merged table
  cells, tables the editor produced) is returned as HTML inside the Markdown and
  accepted back unchanged, so reading a finding and writing it back does not
  lose it.
- Images are neither uploaded nor removed by this API. An image already in a
  finding is returned as `![caption](<imageId>)` and preserved when written
  back; new images are added from the web interface.

Because updates only touch the fields of the request, a client can fill
`remediation` without disturbing the images, tables or hand formatting someone
added elsewhere in the same finding.

## Examples

Create a finding:

```bash
curl -k -X POST https://pwndoc.example.com/api/v1/findings \
  -H "X-API-Key: $PWNDOC_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "SQL injection in the user search",
    "cvss_string": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
    "description": "The `id` parameter of `/api/users` is concatenated into the query.\n\n```http\nGET /api/users?id=1 OR 1=1 HTTP/1.1\n```",
    "affected_assets": "- https://a.example.com/api/users",
    "references": "- https://cwe.mitre.org/data/definitions/89.html",
    "business_impact": "Full read access to the **customer** database."
  }'
```

```json
{
  "status": "success",
  "datas": {
    "id": "66037a1b2c3d4e5f60718293",
    "identifier": 1,
    "title": "SQL injection in the user search",
    "cvss_string": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
    "cvss": {"score": 7.5, "severity": "High"},
    "status": "redacting",
    "custom_fields": {"business_impact": "Full read access to the **customer** database."}
  }
}
```

Add a remediation to that finding, leaving everything else as it is:

```bash
curl -k -X PATCH https://pwndoc.example.com/api/v1/findings/66037a1b2c3d4e5f60718293 \
  -H "X-API-Key: $PWNDOC_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"remediation": "Use prepared statements.", "status": "done"}'
```

List what the audit holds:

```bash
curl -k https://pwndoc.example.com/api/v1/findings -H "X-API-Key: $PWNDOC_KEY"
```

The list holds no bodies, only `id`, `identifier`, `title`, `cvss_string`,
`cvss`, `vuln_type`, `category` and `status`; read a finding by id for the rest.

## Answers

| Code | When |
| --- | --- |
| `200` | read, list and update |
| `201` | a finding was created |
| `401` | missing or unknown key |
| `403` | reviews are enabled and the audit is not in the `EDIT` state |
| `404` | no finding with this id **in the audit the key belongs to** |
| `422` | a required field is missing, a value is invalid, or a field is unknown |

Writes follow the same rules as the web interface: an audit under review or
approved cannot be edited while the review workflow is enabled, and a write
removes the approvals when the settings ask for it. Open editors are notified,
so a finding created through the API appears in a browser that has the audit
open without a reload.
