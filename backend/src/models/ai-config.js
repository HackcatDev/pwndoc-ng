/*
 * Global configuration of the AI assistant (Data > AI integration).
 *
 * A single document. It lives outside of Settings on purpose: the settings are
 * returned whole by GET /api/settings and by the settings export, and the API
 * key must never leave the backend. The key is not selected by default and the
 * routes only ever return a masked hint of it.
 */
var mongoose = require('mongoose')
var Schema = mongoose.Schema

var AiConfigSchema = new Schema({
    provider:       {type: String, enum: ['openai', 'anthropic'], default: 'openai'},
    apiHost:        {type: String, default: ''},
    apiKey:         {type: String, default: '', select: false},
    model:          {type: String, default: ''},
    temperature:    {type: Number, min: 0, max: 2, default: null},
    maxTokens:      {type: Number, min: 1, max: 1000000, default: null},
    timeout:        {type: Number, min: 5, max: 3600, default: 120},
    systemPrompt:   {type: String, default: ''},
    extraBody:      {type: String, default: ''},
    // Prompt of each field, by field key (title, description, ..., custom field slug)
    prompts:        {type: Schema.Types.Mixed, default: {}},
}, {timestamps: true, minimize: false})

function keyHint(key) {
    if (!key) return ''
    if (key.length <= 8) return '••••'
    return `${key.slice(0, 3)}…${key.slice(-4)}`
}

// Configuration without the key: {..., apiKeySet, apiKeyHint}
AiConfigSchema.statics.getPublicConfig = async () => {
    var row = await AiConfig.findOne({}).select('+apiKey').lean()
    if (!row) row = {provider: 'openai', apiHost: '', apiKey: '', model: '', temperature: null, maxTokens: null, timeout: 120, systemPrompt: '', extraBody: '', prompts: {}}
    var result = {
        provider: row.provider || 'openai',
        apiHost: row.apiHost || '',
        model: row.model || '',
        temperature: row.temperature === undefined ? null : row.temperature,
        maxTokens: row.maxTokens === undefined ? null : row.maxTokens,
        timeout: row.timeout || 120,
        systemPrompt: row.systemPrompt || '',
        extraBody: row.extraBody || '',
        prompts: row.prompts || {},
        apiKeySet: !!row.apiKey,
        apiKeyHint: keyHint(row.apiKey),
    }
    return result
}

// Configuration with the key, for the model calls only
AiConfigSchema.statics.getFullConfig = async () => {
    var row = await AiConfig.findOne({}).select('+apiKey').lean()
    return row || {provider: 'openai', apiHost: '', apiKey: '', model: '', timeout: 120, prompts: {}}
}

// The assistant can be used once a host and a model are set
AiConfigSchema.statics.isConfigured = (config) => !!(config && config.apiHost && config.model)

AiConfigSchema.statics.updateConfig = async (update) => {
    await AiConfig.findOneAndUpdate({}, {$set: update}, {upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true})
    return AiConfig.getPublicConfig()
}

var AiConfig = mongoose.model('AiConfig', AiConfigSchema)
module.exports = AiConfig
