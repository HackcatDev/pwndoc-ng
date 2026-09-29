# AI assistant

The finding editor can call a language model to write or rewrite a field: Title, Description, Observation, References, Remediation and every rich text custom field of the findings (for example `Business_Impact`). The answer never replaces what is written:

- **Rich text fields and custom fields**: the answer is added at the end of the field, after a separator paragraph `--------------------------------------------- AI: <model>`. Keep the parts you want and delete the rest, including the separator. An empty field is simply filled.
- **References**: the separator line and the new references are added below the current ones.
- **Title**: a dialog shows the current title and the proposed one (editable). *Replace* applies it.

Nothing is saved automatically: save the finding (`Ctrl+S`) as after any other change.

While the model answers, the button of the field shows an animation and the field is read-only. Errors of the model (refused key, unknown model, rate limit, timeout, unreachable host...) are shown as a notification in the top right corner.

## Configuration

### Data > AI integration (global, admins)

Requires the `ai:update` permission (admins only by default).

| Setting | |
|---|---|
| API type | *OpenAI-style* (`POST <host>/chat/completions`, OpenAI, Azure-compatible gateways, OpenRouter, vLLM, Ollama, LM Studio...) or *Anthropic-style* (`POST <host>/v1/messages`) |
| API host | Base URL, e.g. `https://api.openai.com/v1`, `https://api.anthropic.com`. The request is sent **by the backend container**: a model running on the Docker host is reached at `http://host.docker.internal:<port>/v1` (on Linux, add `extra_hosts: ["host.docker.internal:host-gateway"]` to the backend service), not `localhost` |
| API key | Stored in the database and never sent back to the browser, only a hint (`sk-…abcd`). Leave empty to keep the saved key, the bin icon removes it. Optional for local servers |
| Model name | Sent as is, e.g. `gpt-4o`, `claude-sonnet-4-5`, `llama3.1` |
| Temperature, max output tokens | Empty: not sent (default of the model). Anthropic requires a maximum, 4096 when empty |
| Timeout | Seconds, 120 by default |
| System prompt | Optional, sent with every request |
| Extra body parameters | JSON object merged into the request body, e.g. `{"reasoning_effort": "low"}` or `{"max_completion_tokens": 2000}` for OpenAI models that refuse `max_tokens` |
| Prompts | One per field. An empty prompt uses the built-in one |

*Test the connection* sends a short prompt with the values of the form, saved or not. The saved key is only reused when the API host is the saved one.

The API key lives in the `aiconfigs` collection: database backups hold it.

### General Information of an audit

- **Enable AI features**: shows the assistant buttons in the finding editor of this audit (off by default). Turned off, no button is displayed and the backend refuses the requests of this audit.
- **Prompt overrides**: a prompt per field for this audit only. Empty: the global prompt is used.

Using the assistant requires the `ai:generate` permission (every built-in role has it through `user`) and the right to edit the audit. It is not available on an audit under review when reviews are enabled.

## Prompts and placeholders

The prompt of a field is the first defined of: the audit override, the global prompt, the built-in prompt. `{name}` placeholders are replaced with the values the editor holds when the button is clicked (saved or not). Rich text is given as Markdown, images as `![alt](<image id>)`. An unknown placeholder is sent as is (the prompt editors flag it).

| Placeholder | Value |
|---|---|
| `{audit_name}` | Name of the audit |
| `{audit_type}` | Type of the audit |
| `{company_name}` | Company of the audit |
| `{client_name}` | Client contact (first and last name) |
| `{report_language}` | Language of the audit, name (e.g. English) |
| `{report_locale}` | Language of the audit, code (e.g. en) |
| `{audit_scope}` | Scope, one item per line |
| `{date_start}`, `{date_end}` | Dates of the audit |
| `{title}` | Title of the finding |
| `{vuln_type}` | Type of the finding |
| `{category}` | Category of the finding |
| `{description}`, `{observation}`, `{remediation}` | Rich text fields (Markdown) |
| `{poc}` | Proofs (Markdown) |
| `{affected_assets}` | Affected assets (Markdown) |
| `{references}` | References, one per line |
| `{remediation_complexity}` | Easy, Medium or Complex |
| `{priority}` | Low, Medium, High or Urgent |
| `{cvss_string}`, `{cvss_score}`, `{cvss_severity}` | CVSS vector, base score, severity |
| `{<custom field slug>}` | Each custom field of the findings, e.g. `{business_impact}`: label in lower case, spaces removed, other characters replaced by `_` (the same name as in the report template) |
| `{selected_field}` | Key of the field being written (`description`, `business_impact`...) |
| `{selected_field_label}` | Label of the field being written |
| `{current_value}` | Current content of the field being written |

The answer is expected in Markdown for rich text fields, one reference per line for References and a single line for the Title. A code fence around the whole answer and `<think>` blocks are removed.

## API

| Endpoint | Permission | |
|---|---|---|
| `GET /api/ai/status` | `ai:generate` | configured or not, fields, global and built-in prompts, placeholders |
| `GET /api/ai/config`, `PUT /api/ai/config` | `ai:update` | global configuration (`apiKey` write only, `clearApiKey: true` removes it) |
| `POST /api/ai/test` | `ai:update` | test a configuration |
| `POST /api/audits/:auditId/findings/:findingId/ai` | `ai:generate` + `audits:update` | body `{field, finding}` (finding: the editor values), answer `{field, kind, value, model}`, where `value` is editor HTML, an array of lines or a string |

Errors of the model provider are answered `502` (`504` on timeout) with a readable message.
