<template>
<div>
  <breadcrumb
    buttons
    :title="audit?.name ? `${audit.name} (${audit.auditType || $t('msg.auditTypeNotSet')})` : 'Loading...'"
    :state="parentState"
    :approvals="parentApprovals"
  >
    <template v-slot:buttons>
      <q-btn
        v-if="editable"
        color="positive"
        :label="$t('btn.save') + ' (ctrl+s)'"
        no-caps
        @click="updateAccounts"
      />
    </template>
  </breadcrumb>

  <div class="row q-pa-md">
    <q-card class="col-md-10 offset-md-1 col-12">
      <q-card-section class="row items-center">
        <div class="col">
          <div class="text-h6">{{$t('testAccounts')}}</div>
          <div class="text-caption text-grey-7">{{$t('testAccountsInfo')}}</div>
        </div>
        <div class="col-auto" v-if="editable">
          <q-btn color="secondary" icon="add" :label="$t('addAccount')" no-caps unelevated @click="addAccount" />
        </div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <q-markup-table flat bordered dense separator="cell" v-if="accounts.length">
          <thead>
            <tr>
              <th class="text-left" style="width: 20%">{{$t('accountService')}}</th>
              <th class="text-left" style="width: 17%">{{$t('accountUsername')}} *</th>
              <th class="text-left" style="width: 17%">{{$t('accountPassword')}} *</th>
              <th class="text-left" style="width: 17%">{{$t('accountOtpSecret')}}</th>
              <th class="text-left">{{$t('accountNotes')}}</th>
              <th style="width: 1px" v-if="editable"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(account, index) of accounts" :key="index">
              <td><q-input v-model="account.service" dense borderless placeholder="https://..." :readonly="!editable" /></td>
              <td><q-input v-model="account.username" dense borderless :readonly="!editable" /></td>
              <td>
                <q-input v-model="account.password" dense borderless :type="visible[index] ? 'text' : 'password'" :readonly="!editable">
                  <template v-slot:append>
                    <q-icon :name="visible[index] ? 'visibility_off' : 'visibility'" class="cursor-pointer" size="xs" @click="visible[index] = !visible[index]" />
                  </template>
                </q-input>
              </td>
              <td><q-input v-model="account.otpSecret" dense borderless :readonly="!editable" /></td>
              <td><q-input v-model="account.notes" dense borderless autogrow :readonly="!editable" /></td>
              <td v-if="editable" class="text-no-wrap">
                <q-btn flat dense size="sm" icon="arrow_upward" :disable="index === 0" @click="moveAccount(index, -1)" />
                <q-btn flat dense size="sm" icon="arrow_downward" :disable="index === accounts.length - 1" @click="moveAccount(index, 1)" />
                <q-btn flat dense size="sm" color="negative" icon="delete" @click="accounts.splice(index, 1)">
                  <q-tooltip>{{$t('removeAccount')}}</q-tooltip>
                </q-btn>
              </td>
            </tr>
          </tbody>
        </q-markup-table>
        <div v-else class="text-grey-7 text-center q-pa-md">{{$t('noAccounts')}}</div>
      </q-card-section>
    </q-card>
  </div>
</div>
</template>

<script>
import { Notify, Dialog } from 'quasar'

import Breadcrumb from 'components/breadcrumb'

import AuditService from '@/services/audit'
import Utils from '@/services/utils'
import { $t } from '@/boot/i18n'

export default {
  props: {
    frontEndAuditState: Number,
    parentState: String,
    parentApprovals: Array,
    audit: Object
  },

  components: {
    Breadcrumb
  },

  data: function() {
    return {
      auditId: null,
      accounts: [],
      accountsOrig: [],
      visible: {},
      AUDIT_VIEW_STATE: Utils.AUDIT_VIEW_STATE
    }
  },

  computed: {
    editable: function() {
      return this.frontEndAuditState === this.AUDIT_VIEW_STATE.EDIT
    }
  },

  mounted: function() {
    this.auditId = this.$route.params.auditId
    this.getAccounts()
    this.$socket.emit('menu', {menu: 'accounts', room: this.auditId})
    document.addEventListener('keydown', this._listener, false)
  },

  unmounted: function() {
    document.removeEventListener('keydown', this._listener, false)
  },

  beforeRouteLeave (to, from, next) {
    if (this.$_.isEqual(this.cleanAccounts(this.accounts), this.cleanAccounts(this.accountsOrig)))
      next()
    else {
      Dialog.create({
        title: $t('msg.thereAreUnsavedChanges'),
        message: $t('msg.doYouWantToLeave'),
        ok: {label: $t('btn.confirm'), color: 'negative'},
        cancel: {label: $t('btn.cancel'), color: 'white'}
      })
      .onOk(() => next())
    }
  },

  methods: {
    _listener: function(e) {
      if ((window.navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey) && e.keyCode == 83) {
        e.preventDefault()
        if (this.editable && this.$route.name === 'accounts')
          this.updateAccounts()
      }
    },

    getAccounts: function() {
      AuditService.getAuditAccounts(this.auditId)
      .then((data) => {
        this.accounts = (data.data.datas.testAccounts || []).map(a => Object.assign({service: '', username: '', password: '', otpSecret: '', notes: ''}, a))
        this.accountsOrig = this.$_.cloneDeep(this.accounts)
      })
      .catch((err) => {
        console.log(err)
      })
    },

    // Rows without any value are not saved
    cleanAccounts: function(accounts) {
      return accounts
      .map(a => ({
        service: (a.service || '').trim(),
        username: (a.username || '').trim(),
        password: a.password || '',
        otpSecret: (a.otpSecret || '').trim(),
        notes: a.notes || ''
      }))
      .filter(a => a.service || a.username || a.password || a.otpSecret || a.notes)
    },

    addAccount: function() {
      this.accounts.push({service: '', username: '', password: '', otpSecret: '', notes: ''})
    },

    moveAccount: function(index, offset) {
      var target = index + offset
      if (target < 0 || target >= this.accounts.length) return
      var row = this.accounts.splice(index, 1)[0]
      this.accounts.splice(target, 0, row)
    },

    updateAccounts: function() {
      var accounts = this.cleanAccounts(this.accounts)
      AuditService.updateAuditAccounts(this.auditId, accounts)
      .then(() => {
        this.accounts = this.$_.cloneDeep(accounts)
        this.accountsOrig = this.$_.cloneDeep(accounts)
        Notify.create({
          message: $t('msg.auditUpdateOk'),
          color: 'positive',
          textColor: 'white',
          position: 'top-right'
        })
      })
      .catch((err) => {
        Notify.create({
          message: err.response ? err.response.data.datas : String(err),
          color: 'negative',
          textColor: 'white',
          position: 'top-right'
        })
      })
    }
  }
}
</script>
