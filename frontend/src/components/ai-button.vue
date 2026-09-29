<template>
    <q-btn
        round
        flat
        dense
        size="md"
        color="secondary"
        icon="fa fa-magic"
        :loading="loading"
        :disable="disable"
        @click.stop="$emit('click')"
    >
        <template v-slot:loading>
            <q-spinner-dots color="secondary" size="1.2em" />
        </template>
        <q-tooltip anchor="top middle" self="bottom middle" :delay="300">{{loading ? $t('ai.generating') : $t('ai.buttonTooltip')}}</q-tooltip>
    </q-btn>
</template>

<script>
// Button of the AI assistant next to a field of the finding editor
export default {
    name: 'AiButton',
    emits: ['click'],
    props: {
        loading: {type: Boolean, default: false},
        disable: {type: Boolean, default: false}
    }
}
</script>
