<template src='./edit.html'></template>

<script src='./edit.js'></script>

<style>
.sortable-drag img {
    position: relative;
    max-width: 600px!important;
    max-height: 600px!important;
}
.paragraph-ghost .sortable-ghost img {
    max-width: 600px!important;
    max-height: 600px!important;
}
/* Advice of the quality advisor (sanitized HTML, read only) */
.ai-advice p {
    margin: 0 0 6px 0;
}
.ai-advice ul, .ai-advice ol {
    margin: 0 0 6px 0;
    padding-left: 22px;
}
.ai-advice li > p {
    margin: 0;
}
.ai-advice code {
    background: #f2f2f2;
    padding: 0 3px;
    border-radius: 3px;
}
.ai-advice pre {
    background: #f2f2f2;
    padding: 6px;
    white-space: pre-wrap;
}
</style>