import { api } from 'boot/axios'

export default {
  // Can the assistant be used, fields, prompts and placeholders (users)
  getStatus: function() {
    return api.get('ai/status')
  },

  // Global configuration (ai:update), never holds the API key
  getConfig: function() {
    return api.get('ai/config')
  },

  updateConfig: function(config) {
    return api.put('ai/config', config)
  },

  testConfig: function(config) {
    return api.post('ai/test', config)
  },

  // Write one field of a finding from the values the editor holds
  generate: function(auditId, findingId, field, finding) {
    return api.post(`audits/${auditId}/findings/${findingId}/ai`, {field: field, finding: finding})
  }
}
