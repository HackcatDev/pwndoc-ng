<template>
<div class="row">
    <div class="col-md-10 col-12 offset-md-1 q-mt-md">
        <q-card>
            <q-card-section class="row items-center">
                <div class="col">
                    <div class="text-h6">{{$t('ai.integration')}}</div>
                    <div class="text-grey-8">{{$t('ai.integrationInfo')}}</div>
                </div>
            </q-card-section>
            <q-card-section class="q-pt-none">
                <q-banner dense class="bg-orange-1 text-orange-10">
                    <template v-slot:avatar><q-icon name="warning" color="orange-10" /></template>
                    {{$t('ai.dataWarning')}}
                </q-banner>
            </q-card-section>

            <q-separator />

            <q-card-section v-if="loading" class="text-center q-pa-lg">
                <q-spinner-dots size="40px" color="secondary" />
            </q-card-section>

            <q-card-section v-else class="row q-col-gutter-md">
                <q-select
                    class="col-md-4 col-12"
                    outlined
                    stack-label
                    :label="$t('ai.provider')"
                    v-model="config.provider"
                    :options="providerOptions"
                    emit-value
                    map-options
                />
                <q-input
                    class="col-md-8 col-12"
                    outlined
                    stack-label
                    :label="$t('ai.apiHost')"
                    v-model="config.apiHost"
                    :placeholder="config.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'"
                    :hint="config.provider === 'anthropic' ? $t('ai.apiHostHintAnthropic') : $t('ai.apiHostHintOpenai')"
                />
                <q-input
                    class="col-md-6 col-12"
                    outlined
                    stack-label
                    :label="$t('ai.apiKey')"
                    v-model="apiKey"
                    :type="apiKeyVisible ? 'text' : 'password'"
                    :placeholder="clearApiKey ? $t('ai.apiKeyWillBeRemoved') : (config.apiKeySet ? $t('ai.apiKeyKeep', [config.apiKeyHint]) : $t('ai.apiKeyNone'))"
                    :hint="$t('ai.apiKeyHint')"
                    autocomplete="new-password"
                >
                    <template v-slot:append>
                        <q-icon :name="apiKeyVisible ? 'visibility_off' : 'visibility'" class="cursor-pointer" @click="apiKeyVisible = !apiKeyVisible" />
                        <q-icon v-if="config.apiKeySet && !clearApiKey" name="delete" class="cursor-pointer q-ml-sm" color="negative" @click="clearApiKey = true; apiKey = ''">
                            <q-tooltip>{{$t('ai.removeApiKey')}}</q-tooltip>
                        </q-icon>
                    </template>
                </q-input>
                <q-input
                    class="col-md-6 col-12"
                    outlined
                    stack-label
                    :label="$t('ai.model') + ' *'"
                    v-model="config.model"
                    :placeholder="config.provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o'"
                />
                <q-input class="col-md-4 col-12" outlined stack-label type="number" min="0" max="2" step="0.1" :label="$t('ai.temperature')" v-model="config.temperature" :hint="$t('ai.emptyDefault')" clearable />
                <q-input class="col-md-4 col-12" outlined stack-label type="number" min="1" :label="$t('ai.maxTokens')" v-model="config.maxTokens" :hint="config.provider === 'anthropic' ? $t('ai.maxTokensHintAnthropic') : $t('ai.emptyDefault')" clearable />
                <q-input class="col-md-4 col-12" outlined stack-label type="number" min="5" max="3600" :label="$t('ai.timeout')" v-model="config.timeout" />
                <q-input
                    class="col-12"
                    outlined
                    stack-label
                    type="textarea"
                    autogrow
                    :label="$t('ai.systemPrompt')"
                    :hint="$t('ai.systemPromptHint')"
                    v-model="config.systemPrompt"
                />
                <q-input
                    class="col-12"
                    outlined
                    stack-label
                    type="textarea"
                    autogrow
                    :label="$t('ai.extraBody')"
                    :hint="$t('ai.extraBodyHint')"
                    :error="extraBodyError"
                    :error-message="$t('ai.extraBodyInvalid')"
                    input-style="font-family: monospace"
                    v-model="config.extraBody"
                />
                <div class="col-12 row items-center q-gutter-sm">
                    <q-btn outline color="secondary" icon="network_check" :label="$t('ai.test')" no-caps :loading="testing" :disable="!config.apiHost || !config.model" @click="test()">
                        <template v-slot:loading>
                            <q-spinner-dots class="on-left" />{{$t('ai.testing')}}
                        </template>
                    </q-btn>
                    <div v-if="testResult" class="text-positive">
                        <q-icon name="check_circle" /> {{$t('ai.testOk', [testResult.model, testResult.ms])}} «{{testResult.answer}}»
                    </div>
                </div>
            </q-card-section>

            <q-separator />

            <q-card-section v-if="!loading">
                <div class="text-bold">{{$t('ai.prompts')}}</div>
                <div class="text-grey-8 q-mb-sm">{{$t('ai.promptsInfo')}}</div>
                <ai-prompts
                    v-model="config.prompts"
                    :fields="fields"
                    :base-prompts="defaultPrompts"
                    :placeholders="placeholders"
                    :custom-placeholder-help="customPlaceholderHelp"
                    :inherit-label="$t('ai.builtinPrompt')"
                    :copy-label="$t('ai.copyBuiltinPrompt')"
                />
            </q-card-section>

            <q-separator />

            <q-card-actions align="right">
                <q-btn color="secondary" unelevated no-caps :label="$t('btn.save')" :loading="saving" :disable="loading || extraBodyError" @click="save()" />
            </q-card-actions>
        </q-card>
    </div>
</div>
</template>

<script>
import { Notify } from 'quasar'

import AiPrompts from 'components/ai-prompts'
import AiService from '@/services/ai'

import { $t } from '@/boot/i18n'

export default {
    data: function() {
        return {
            loading: true,
            saving: false,
            testing: false,
            testResult: null,
            config: {provider: 'openai', apiHost: '', model: '', temperature: null, maxTokens: null, timeout: 120, systemPrompt: '', extraBody: '', prompts: {}, apiKeySet: false, apiKeyHint: ''},
            apiKey: '',
            apiKeyVisible: false,
            clearApiKey: false,
            fields: [],
            defaultPrompts: {},
            placeholders: [],
            customPlaceholderHelp: '',
            providerOptions: [
                {label: 'OpenAI-style (chat completions)', value: 'openai'},
                {label: 'Anthropic-style (messages)', value: 'anthropic'}
            ]
        }
    },

    components: {
        AiPrompts
    },

    computed: {
        extraBodyError: function() {
            var value = (this.config.extraBody || '').trim()
            if (!value) return false
            try {
                var parsed = JSON.parse(value)
                return !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
            } catch (err) {
                return true
            }
        }
    },

    mounted: function() {
        this.getConfig()
    },

    methods: {
        notifyError: function(err) {
            Notify.create({
                message: (err && err.response && err.response.data && err.response.data.datas) || String(err),
                color: 'negative',
                textColor: 'white',
                position: 'top-right'
            })
        },

        load: function(datas) {
            this.config = Object.assign({}, datas.config, {prompts: Object.assign({}, datas.config.prompts || {})})
            this.fields = datas.fields || []
            this.defaultPrompts = datas.defaultPrompts || {}
            this.placeholders = datas.placeholders || []
            this.customPlaceholderHelp = datas.customPlaceholderHelp || ''
            this.apiKey = ''
            this.clearApiKey = false
        },

        getConfig: function() {
            this.loading = true
            AiService.getConfig()
            .then((data) => {
                this.load(data.data.datas)
            })
            .catch((err) => this.notifyError(err))
            .finally(() => { this.loading = false })
        },

        payload: function() {
            var result = {
                provider: this.config.provider,
                apiHost: this.config.apiHost,
                model: this.config.model,
                temperature: this.config.temperature === '' ? null : this.config.temperature,
                maxTokens: this.config.maxTokens === '' ? null : this.config.maxTokens,
                timeout: this.config.timeout,
                systemPrompt: this.config.systemPrompt,
                extraBody: this.config.extraBody,
                prompts: this.config.prompts
            }
            if (this.clearApiKey) result.clearApiKey = true
            else if (this.apiKey) result.apiKey = this.apiKey
            return result
        },

        save: function() {
            this.saving = true
            AiService.updateConfig(this.payload())
            .then(() => {
                Notify.create({
                    message: $t('ai.saved'),
                    color: 'positive',
                    textColor: 'white',
                    position: 'top-right'
                })
                this.getConfig()
            })
            .catch((err) => this.notifyError(err))
            .finally(() => { this.saving = false })
        },

        test: function() {
            this.testing = true
            this.testResult = null
            AiService.testConfig(this.payload())
            .then((data) => {
                this.testResult = data.data.datas
            })
            .catch((err) => this.notifyError(err))
            .finally(() => { this.testing = false })
        }
    }
}
</script>
