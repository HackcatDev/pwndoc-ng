/*
 * Quality advisor and images for the AI (lib/ai.js, lib/ai-images.js), without database.
 */
module.exports = function () {
  var ai = require('../src/lib/ai')
  var aiImages = require('../src/lib/ai-images')
  var { PNG } = require('pngjs')

  describe('AI quality advisor', () => {
    it('reads the verdict wherever the model put its formatting', () => {
      expect(ai.parseAdvice('VERDICT: ok\nAll good.').verdict).toBe('ok')
      expect(ai.parseAdvice('**VERDICT:** weak\n\n- more').verdict).toBe('weak')
      expect(ai.parseAdvice('<think>hmm</think>\n# VERDICT: INSUFFICIENT\ntext').verdict).toBe('insufficient')
      var noVerdict = ai.parseAdvice('Just text')
      expect(noVerdict.verdict).toBe('unknown')
      expect(noVerdict.html).toBe('<p>Just text</p>')
    })

    it('never renders links, images nor HTML of the model', () => {
      var html = ai.adviceHtml('[x](javascript:alert(1)) ![p](https://evil.test/p.png) <img src=x onerror=alert(1)> <script>alert(1)</script> <b onclick="x">b</b>')
      expect(html).not.toMatch(/<a\b|<img\b|<script|onerror|onclick|javascript:/i)
    })

    it('raises the flag on insufficient, lowers only its own flag on ok', () => {
      expect(ai.flagUpdate({}, {verdict: 'insufficient', hash: 'h'})).toEqual({lowQuality: true, lowQualitySource: 'ai'})
      expect(ai.flagUpdate({lowQualityDismissedHash: 'h'}, {verdict: 'insufficient', hash: 'h'})).toEqual({})
      expect(ai.flagUpdate({lowQualityDismissedHash: 'old'}, {verdict: 'insufficient', hash: 'h'})).toEqual({lowQuality: true, lowQualitySource: 'ai'})
      expect(ai.flagUpdate({lowQuality: true, lowQualitySource: 'ai'}, {verdict: 'ok', hash: 'h'})).toEqual({lowQuality: false, lowQualitySource: null})
      expect(ai.flagUpdate({lowQuality: true, lowQualitySource: 'user'}, {verdict: 'ok', hash: 'h'})).toEqual({})
      expect(ai.flagUpdate({lowQuality: true, lowQualitySource: 'ai'}, {verdict: 'weak', hash: 'h'})).toEqual({})
    })

    it('gives the context of the audit only: the other findings by title', () => {
      var audit = {name: 'A', aiContext: 'PHP execution is a feature', aiAdvisorLanguage: 'Russian', findings: [
        {_id: '1', title: 'IDOR on /api/users', description: '<p>secret details</p>'},
        {_id: '2', title: 'IDOR on /api/orders', cvssv3: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N', vulnType: 'BAC'},
      ]}
      var prompt = ai.reviewPrompt({config: {model: 'm', advisorLanguage: 'English'}, audit, finding: Object.assign({aiHints: 'no PoC needed'}, audit.findings[0])}).prompt
      expect(prompt).toContain('- [Medium 6.5] IDOR on /api/orders (BAC)')
      expect(prompt).not.toContain('- [no CVSS] IDOR on /api/users')
      expect(prompt).toContain('PHP execution is a feature')
      expect(prompt).toContain('no PoC needed')
      expect(prompt).toContain('Answer in Russian') // the audit overrides the global language
      expect(prompt).toContain('The finding holds no image.')
    })

    it('has a stable fingerprint that follows the inputs', () => {
      var base = {config: {model: 'm'}, audit: {findings: []}, finding: {_id: '1', title: 'T', description: '<p>d</p>'}}
      var h1 = ai.reviewPrompt(base).hash
      expect(ai.reviewPrompt(base).hash).toBe(h1)
      expect(ai.reviewPrompt(Object.assign({}, base, {finding: {_id: '1', title: 'T2', description: '<p>d</p>'}})).hash).not.toBe(h1)
      expect(ai.reviewPrompt(Object.assign({}, base, {sendImages: true})).hash).not.toBe(h1)
      expect(ai.reviewPrompt(Object.assign({}, base, {finding: Object.assign({status: 0, lowQuality: true}, base.finding)})).hash).toBe(h1)
    })

    it('sends the notes of the auditors only where the prompt has their placeholder', () => {
      expect(ai.renderPrompt('Write {title}', {title: 'X', project_context: 'ctx', finding_hints: 'h'})).toBe('Write X')
      expect(ai.renderPrompt('{project_context} / {title}', {title: 'X', project_context: 'ctx'})).toBe('ctx / X')
      var builtin = ai.render(ai.defaultPrompt('observation'), {project_context: 'CTX', finding_hints: 'HINT', images_note: 'IMG'})
      expect(builtin).toContain('CTX')
      expect(builtin).toContain('HINT')
      expect(builtin).toContain('IMG')
      expect(ai.reviewPrompt({config: {model: 'm'}, audit: {findings: []}, finding: {_id: '1'}}).prompt).toContain('Answer in English')
    })

    it('builds multimodal messages for both API styles', () => {
      var images = [{mediaType: 'image/jpeg', data: 'AAA', caption: 'Burp', field: 'Proofs'}]
      var openai = ai.buildRequest({apiHost: 'https://h/v1', model: 'm'}, 'p', images).body.messages[0].content
      expect(openai).toEqual([{type: 'text', text: 'p'}, {type: 'text', text: 'Image 1 (Proofs): Burp'}, {type: 'image_url', image_url: {url: 'data:image/jpeg;base64,AAA'}}])
      var anthropic = ai.buildRequest({apiHost: 'https://h', model: 'm', provider: 'anthropic'}, 'p', images).body.messages[0].content
      expect(anthropic[2]).toEqual({type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: 'AAA'}})
      expect(ai.buildRequest({apiHost: 'https://h/v1', model: 'm'}, 'p').body.messages[0].content).toBe('p')
    })
  })

  describe('Images for the AI', () => {
    var png = (w, h) => { var p = new PNG({width: w, height: h}); p.data.fill(128); return 'data:image/png;base64,' + PNG.sync.write(p).toString('base64') }

    it('lists the images of the fields, never an external URL', () => {
      var refs = aiImages.collect([
        {label: 'Observation', html: '<img src="660000000000000000000aaa" alt="A &amp; B"><img src="https://evil.test/x.png" alt="x">'},
        {label: 'Proofs', html: '<img src="660000000000000000000aaa" alt="again"><img src="data:image/png;base64,AA" alt="inline">'},
      ])
      expect(refs).toEqual([
        {src: '660000000000000000000aaa', caption: 'A & B', field: 'Observation'},
        {src: 'data:image/png;base64,AA', caption: 'inline', field: 'Proofs'},
      ])
    })

    it('keeps small images and scales the large ones down', () => {
      expect(aiImages.prepare(png(100, 50)).mediaType).toBe('image/png')
      var big = aiImages.prepare(png(3200, 400))
      expect(big.mediaType).toBe('image/jpeg')
      var jpeg = require('jpeg-js').decode(Buffer.from(big.data, 'base64'))
      expect([jpeg.width, jpeg.height]).toEqual([1600, 200])
      expect(aiImages.prepare('https://evil.test/x.png')).toBe(null)
    })

    it('stops at the maximum number of images', async () => {
      var refs = []
      for (var i = 0; i < 15; i++) refs.push({src: png(4, 4), caption: 'c' + i})
      var images = await aiImages.load(refs, async () => null)
      expect(images.length).toBe(aiImages.MAX_IMAGES)
    })
  })
}
