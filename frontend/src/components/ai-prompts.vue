<template>
<div>
    <q-expansion-item
        v-for="field of fields"
        :key="field.key"
        dense
        dense-toggle
        expand-separator
        header-class="bg-grey-2"
    >
        <template v-slot:header>
            <q-item-section>
                <q-item-label>{{field.label}} <span class="text-grey-7 text-caption q-ml-xs">{{field.key}}</span></q-item-label>
            </q-item-section>
            <q-item-section side>
                <q-badge v-if="isSet(field.key)" color="secondary" :label="$t('ai.customized')" />
                <q-badge v-else outline color="grey-7" :label="inheritLabel" />
            </q-item-section>
        </template>
        <div class="q-pa-sm">
            <q-input
                :model-value="modelValue[field.key] || ''"
                @update:model-value="setPrompt(field.key, $event)"
                type="textarea"
                outlined
                autogrow
                input-style="min-height: 8em; max-height: 60vh; font-family: monospace; font-size: 12px"
                :placeholder="basePrompts[field.key] || ''"
                :readonly="readonly"
            />
            <div v-if="unknown(field.key).length" class="text-caption text-orange-9 q-mt-xs">
                <q-icon name="warning" /> {{$t('ai.unknownPlaceholders')}}
                <code v-for="name of unknown(field.key)" :key="name" class="q-mx-xs">{{ braced(name) }}</code>
            </div>
            <div class="row q-gutter-sm q-mt-xs" v-if="!readonly">
                <q-btn flat dense no-caps size="sm" color="secondary" icon="content_copy" :label="copyLabel" :disable="!basePrompts[field.key]" @click="setPrompt(field.key, basePrompts[field.key])" />
                <q-btn flat dense no-caps size="sm" color="negative" icon="clear" :label="$t('ai.clearPrompt')" :disable="!isSet(field.key)" @click="setPrompt(field.key, '')" />
            </div>
        </div>
    </q-expansion-item>

    <q-expansion-item dense dense-toggle icon="help_outline" :label="$t('ai.placeholdersTitle')" header-class="text-grey-8 q-mt-sm">
        <div class="q-pa-sm">
            <div class="text-caption text-grey-8 q-mb-sm">{{$t('ai.placeholdersInfo')}}</div>
            <q-markup-table dense flat bordered separator="horizontal">
                <tbody>
                    <tr v-for="p of placeholders" :key="p.name">
                        <td style="width: 1%; white-space: nowrap"><code>{{ braced(p.name) }}</code></td>
                        <td class="text-grey-8">{{p.description}}</td>
                    </tr>
                </tbody>
            </q-markup-table>
            <div v-if="customPlaceholderHelp" class="text-caption text-grey-8 q-mt-sm">{{customPlaceholderHelp}}</div>
        </div>
    </q-expansion-item>
</div>
</template>

<script>
// Editors of the AI prompts, one per field, with the placeholder reference.
// Used by Data > AI integration (global prompts) and by the general
// information of an audit (overrides). An empty prompt inherits basePrompts.
export default {
    name: 'AiPrompts',
    emits: ['update:modelValue'],
    props: {
        modelValue: {type: Object, default: () => ({})},
        fields: {type: Array, default: () => []},
        basePrompts: {type: Object, default: () => ({})},
        placeholders: {type: Array, default: () => []},
        customPlaceholderHelp: {type: String, default: ''},
        inheritLabel: {type: String, default: ''},
        copyLabel: {type: String, default: ''},
        readonly: {type: Boolean, default: false}
    },
    methods: {
        braced: function(name) {
            return '{' + name + '}'
        },
        isSet: function(key) {
            var value = this.modelValue[key]
            return typeof value === 'string' && value.trim() !== ''
        },
        setPrompt: function(key, value) {
            var prompts = Object.assign({}, this.modelValue)
            if (value && String(value).trim()) prompts[key] = value
            else delete prompts[key]
            this.$emit('update:modelValue', prompts)
        },
        unknown: function(key) {
            var text = this.modelValue[key] || ''
            var known = new Set(this.placeholders.map(p => p.name))
            var result = []
            var re = /\{([A-Za-z0-9_]+)\}/g
            var match
            while ((match = re.exec(text)) !== null) {
                if (!known.has(match[1]) && !result.includes(match[1])) result.push(match[1])
            }
            return result
        }
    }
}
</script>
