import { Dialog, Notify, exportFile } from 'quasar';

import Breadcrumb from 'components/breadcrumb'

import TemplateService from '@/services/template'
import UserService from '@/services/user'
import Utils from '@/services/utils'

import { $t } from '@/boot/i18n'

export default {
    data: () => {
        return {
            UserService: UserService,
            // Templates list
            templates: [],
            // Loading state
            loading: true,
            // Datatable headers
            dtHeaders: [
                {name: 'name', label: $t('name'), field: 'name', align: 'left', sortable: true},
                {name: 'ext', label: $t('extension'), field: 'ext', align: 'left', sortable: true},
                {name: 'action', label: '', field: 'action', align: 'left', sortable: false},
            ],
            // Datatable pagination
            pagination: {
                page: 1,
                rowsPerPage: 25,
                sortBy: 'name',
            },
            rowsPerPageOptions: [
                {label:'25', value:25},
                {label:'50', value:50},
                {label:'100', value:100},
                {label:'All', value:0}
            ],
            // Search filter
            search: {name: '', ext: ''},
            //customFilter: Utils.customFilter,
            // Errors messages
            errors: {name: '', file: ''},
            // Selected or New Vulnerability
            currentTemplate: {
                name: '',
                file: '',
                ext: ''
            },
            templateId: '',
            // Formatting styles (fonts used by convertHTML) of the selected template
            stylesTemplate: null,
            stylesDefaults: {profiles: {}, inlineCode: {}, codeBlock: {}, link: {}},
            currentStyles: {profiles: {}, inlineCode: {}, codeBlock: {}, link: {}, highlightSyntax: null, listNumbering: null, imageSpacing: null},
            newProfileName: '',
            stylesFields: {
                profile: ['font', 'size', 'color', 'bold', 'italic', 'alignment', 'shading', 'spacingBefore', 'spacingAfter', 'lineSpacing', 'pStyle'],
                inlineCode: ['font', 'size', 'color', 'shading', 'rStyle'],
                codeBlock: ['font', 'size', 'color', 'shading', 'spacingBefore', 'spacingAfter', 'lineSpacing', 'pStyle'],
                link: ['color', 'underline', 'rStyle']
            },
            alignmentOptions: [
                {label: $t('styles.inherit'), value: null},
                {label: $t('styles.alignLeft'), value: 'left'},
                {label: $t('styles.alignCenter'), value: 'center'},
                {label: $t('styles.alignRight'), value: 'right'},
                {label: $t('styles.alignJustify'), value: 'justify'}
            ],
            listNumberingOptions: [
                {label: $t('styles.inherit'), value: null},
                {label: $t('styles.listNumberingAuto'), value: 'auto'},
                {label: $t('styles.listNumberingTemplate'), value: 'template'}
            ],
            booleanOptions: [
                {label: $t('styles.inherit'), value: null},
                {label: $t('styles.yes'), value: true},
                {label: $t('styles.no'), value: false}
            ]
        }
    },

    components: {
        Breadcrumb
    },

    mounted: function() {
        this.getTemplates()
    },

    methods: {
        getTemplates: function() {
            this.loading = true
            TemplateService.getTemplates()
            .then((data) => {
                this.templates = data.data.datas
                this.loading = false
            })
            .catch((err) => {
                console.log(err)
            })
        },
        customFilter(rows, terms, cols, getCellValue) {
            // Check if terms is empty
            if (!terms || (terms.name === '' && terms.ext === '')) {
              return rows;
            }
            
            return rows.filter(row => {
              // Check name
              if (terms.name && row.name) {
                const nameMatch = String(row.name).toLowerCase().includes(String(terms.name).toLowerCase());
                if (!nameMatch) return false;
              }
              
              // Check ext
              if (terms.ext && row.ext) {
                const extMatch = String(row.ext).toLowerCase().includes(String(terms.ext).toLowerCase());
                if (!extMatch) return false;
              }
              
              return true;
            });
          },
          
        downloadTemplate: function(row) {
            TemplateService.downloadTemplate(row._id)
            .then((data) => {
                status = exportFile(`${row.name}.${row.ext || 'docx'}`, data.data, {type: "application/octet-stream"})
                if (!status)
                    throw (status)
            })
            .catch((err) => {
                if (err.response.status === 404) {
                    Notify.create({
                        message: $t('msg.templateNotFound'),
                        color: 'negative',
                        textColor: 'white',
                        position: 'top-right'
                    })
                }
                else
                    console.log(err.response)
            })
        },

        createTemplate: function() {
            this.cleanErrors();
            if (!this.currentTemplate.name)
                this.errors.name = $t('msg.nameRequired');
            if (!this.currentTemplate.file)
                this.errors.file = $t('msg.fileRequired');
                
            if (this.errors.name || this.errors.file)
                return;

            TemplateService.createTemplate(this.currentTemplate)
            .then(() => {
                this.getTemplates();
                this.$refs.createModal.hide();
                Notify.create({
                    message: $t('msg.templateCreatedOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        updateTemplate: function() {
            this.cleanErrors();
            if (!this.currentTemplate.name)
                this.errors.name = $t('msg.nameRequired');
            
            if (this.errors.name)
                return;

            TemplateService.updateTemplate(this.templateId, this.currentTemplate)
            .then(() => {
                this.getTemplates();
                this.$refs.editModal.hide();
                Notify.create({
                    message: $t('msg.templateUpdatedOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        deleteTemplate: function(templateId) {
            TemplateService.deleteTemplate(templateId)
            .then((data) => {
                this.getTemplates();
                Notify.create({
                    message: data.data.datas,
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        confirmDeleteTemplate: function(row) {
            Dialog.create({
                title: $t('msg.confirmSuppression'),
                message: `${$t('template')} «${row.name}» ${$t('msg.deleteNotice')}`,
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => this.deleteTemplate(row._id))
        },

        clone: function(row) {
            this.cleanCurrentTemplate();
            
            this.currentTemplate.name = row.name;
            this.templateId = row._id;
        },

        cleanErrors: function() {
            this.errors.name = '';
            this.errors.file = '';
        },

        cleanCurrentTemplate: function() {
            this.cleanErrors();
            this.currentTemplate = {
                name: '',
                file: '',
                ext: ''
            };
            this.templateId = ''
        },

        handleFile: function(files) {
            var file = files[0];
            var fileReader = new FileReader();

            fileReader.onloadend = (e) => {
                this.currentTemplate.file = fileReader.result.split(",")[1];
            }

            this.currentTemplate.ext = file.name.split('.').pop()
            fileReader.readAsDataURL(file);
        },

        // ---- Formatting styles (per template) ----

        emptyStyles: function() {
            return {profiles: {}, inlineCode: {}, codeBlock: {}, link: {}, highlightSyntax: null, listNumbering: null, imageSpacing: null}
        },

        openStyles: function(row) {
            this.stylesTemplate = row
            var styles = this.emptyStyles()
            var saved = row.styles || {}
            TemplateService.getStylesDefaults()
            .then((data) => {
                this.stylesDefaults = data.data.datas.styles || {}
                if (data.data.datas.fields) this.stylesFields = data.data.datas.fields
                // Show every profile known by the defaults plus the template specific ones
                var names = Object.keys(this.stylesDefaults.profiles || {})
                Object.keys(saved.profiles || {}).forEach(n => { if (!names.includes(n)) names.push(n) })
                names.forEach(n => { styles.profiles[n] = Object.assign({}, (saved.profiles || {})[n] || {}) })
                styles.inlineCode = Object.assign({}, saved.inlineCode || {})
                styles.codeBlock = Object.assign({}, saved.codeBlock || {})
                styles.link = Object.assign({}, saved.link || {})
                styles.highlightSyntax = (typeof saved.highlightSyntax === 'boolean') ? saved.highlightSyntax : null
                styles.listNumbering = saved.listNumbering || null
                styles.imageSpacing = (typeof saved.imageSpacing === 'boolean') ? saved.imageSpacing : null
                this.currentStyles = styles
                this.$refs.stylesModal.show()
            })
            .catch((err) => {
                Notify.create({
                    message: err.response ? err.response.data.datas : String(err),
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                })
            })
        },

        // Placeholder showing the value inherited from the global configuration
        stylesDefault: function(section, field, profileName) {
            var src = section === 'profiles' ? ((this.stylesDefaults.profiles || {})[profileName] || {}) : (this.stylesDefaults[section] || {})
            var v = src[field]
            if (v === undefined || v === null || v === '') return $t('styles.inherit')
            if (typeof v === 'boolean') return v ? $t('styles.yes') : $t('styles.no')
            return String(v)
        },

        addProfile: function() {
            var name = (this.newProfileName || '').trim()
            if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
                Notify.create({message: $t('styles.badProfileName'), color: 'negative', textColor: 'white', position: 'top-right'})
                return
            }
            if (!this.currentStyles.profiles[name]) this.currentStyles.profiles[name] = {}
            this.newProfileName = ''
        },

        removeProfile: function(name) {
            delete this.currentStyles.profiles[name]
        },

        isDefaultProfile: function(name) {
            return !!((this.stylesDefaults.profiles || {})[name])
        },

        // Drops empty values so that they inherit from the configuration
        cleanStyles: function(styles) {
            var cleanSection = (obj) => {
                var out = {}
                Object.keys(obj || {}).forEach(k => {
                    var v = obj[k]
                    if (v === null || v === undefined || v === '') return
                    out[k] = v
                })
                return out
            }
            var result = {profiles: {}, inlineCode: cleanSection(styles.inlineCode), codeBlock: cleanSection(styles.codeBlock), link: cleanSection(styles.link)}
            Object.keys(styles.profiles || {}).forEach(n => {
                var p = cleanSection(styles.profiles[n])
                // keep custom profiles even if empty so that they stay listed
                if (Object.keys(p).length || !this.isDefaultProfile(n)) result.profiles[n] = p
            })
            if (typeof styles.highlightSyntax === 'boolean') result.highlightSyntax = styles.highlightSyntax
            if (styles.listNumbering) result.listNumbering = styles.listNumbering
            if (typeof styles.imageSpacing === 'boolean') result.imageSpacing = styles.imageSpacing
            return result
        },

        saveStyles: function() {
            if (!this.stylesTemplate) return
            var styles = this.cleanStyles(this.currentStyles)
            TemplateService.updateTemplateStyles(this.stylesTemplate._id, styles)
            .then(() => {
                this.getTemplates()
                this.$refs.stylesModal.hide()
                Notify.create({
                    message: $t('msg.templateUpdatedOk'),
                    color: 'positive',
                    textColor:'white',
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
        },

        resetStyles: function() {
            Dialog.create({
                title: $t('styles.resetTitle'),
                message: $t('styles.resetConfirm'),
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => {
                this.currentStyles = this.emptyStyles()
                Object.keys(this.stylesDefaults.profiles || {}).forEach(n => { this.currentStyles.profiles[n] = {} })
            })
        },

        dblClick: function(evt, row) {
            if (this.UserService.isAllowed('templates:update')) {
                this.clone(row)
                this.$refs.editModal.show()
            }     
        }
    }
}