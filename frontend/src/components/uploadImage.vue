<template>
  <node-view-wrapper>
    <figure style="margin: auto; display: table; width: 600px">
      <div class="image-frame">
        <q-img
          :src="src"
          :class="{ selected: selected }"
          :style="imageStyle"
          @error="handleImageError"
          spinner-color="primary"
          spinner-size="82px"
        />
        <!-- Border of the image: kept as attributes, the image itself is not modified -->
        <div v-if="editable" class="image-tools">
          <q-btn
            round
            dense
            size="sm"
            :color="borderWidth ? 'secondary' : 'grey-7'"
            icon="border_outer"
          >
            <q-tooltip>{{ $t('imageBorder.title') }}</q-tooltip>
            <q-menu anchor="bottom right" self="top right">
              <div class="q-pa-sm" style="width: 260px">
                <div class="text-caption text-grey-8">{{ $t('imageBorder.width') }}</div>
                <q-btn-toggle
                  :model-value="borderWidth"
                  @update:model-value="setBorder($event, null)"
                  :options="widthOptions"
                  dense
                  unelevated
                  toggle-color="secondary"
                  class="q-mb-sm"
                />
                <div class="text-caption text-grey-8">{{ $t('imageBorder.color') }}</div>
                <div class="row q-gutter-xs q-mb-sm">
                  <div
                    v-for="color of colors"
                    :key="color"
                    class="color-swatch cursor-pointer"
                    :class="{ active: borderColor === color }"
                    :style="{ background: '#' + color }"
                    @click="setBorder(null, color)"
                  />
                </div>
                <q-input
                  dense
                  outlined
                  prefix="#"
                  maxlength="6"
                  :model-value="borderColor || ''"
                  @update:model-value="setBorder(null, $event)"
                />
                <q-btn
                  class="q-mt-sm full-width"
                  flat
                  dense
                  no-caps
                  color="negative"
                  icon="undo"
                  :label="$t('imageBorder.remove')"
                  :disable="!borderWidth"
                  @click="removeBorder"
                >
                  <q-tooltip>{{ $t('imageBorder.removeHint') }}</q-tooltip>
                </q-btn>
              </div>
            </q-menu>
          </q-btn>
        </div>
      </div>
      <div v-if="imageError" class="text-center q-pa-md">
        <q-icon name="error" color="negative" size="48px" />
        <div class="text-caption text-negative q-mt-sm">
          Impossible de charger l'image
        </div>
        <q-btn
          flat
          color="primary"
          size="sm"
          @click="retryLoad"
          class="q-mt-sm"
        >
          Réessayer
        </q-btn>
      </div>
      <div>
        <q-input
          input-class="text-center cursor-pointer"
          readonly
          borderless
          dense
          v-model="alt"
          placeholder="Caption"
        />
        <!-- the caption is set when the popup closes (see the alt setter) -->
        <q-popup-edit v-model="alt" auto-save v-slot="scope">
          <q-input
            input-class="text-center"
            autofocus
            v-model="scope.value"
            placeholder="Caption"
            @keyup.enter="scope.set"
          />
        </q-popup-edit>
      </div>
    </figure>
  </node-view-wrapper>
</template>
<script>
import { defineComponent } from 'vue';

import { NodeViewWrapper, nodeViewProps } from "@tiptap/vue-3";
import Utils from "@/services/utils";
import { captionAttrs } from "./image-caption";

const DEFAULT_BORDER_COLOR = "000000";

export default defineComponent({
  components: {
    NodeViewWrapper,
  },

  //["node", "updateAttrs", "view", "getPos", "selected"],
  props: nodeViewProps,

  data() {
    return {
      imageError: false,
      widthOptions: [1, 2, 3, 4, 6].map((w) => ({ label: String(w), value: w })),
      colors: ["000000", "7F7F7F", "D9D9D9", "FF0000", "0070C0", "00B050", "FFC000", "7030A0"],
    }
  },

  computed: {
    src: {
      get() {
        return Utils.normalizeImageUrl(this.node.attrs.src);
      },
      set(src) {
        this.updateAttributes({
          src,
        });
      },
    },
    alt: {
      get() {
        return this.node.attrs.alt;
      },
      // a trailing dot is removed the first time, kept when typed back
      set(alt) {
        this.updateAttributes(captionAttrs(alt, this.node.attrs.captionTrimmed));
      },
    },
    borderWidth() {
      return this.node.attrs.borderWidth || null;
    },
    borderColor() {
      return this.node.attrs.borderColor || null;
    },
    editable() {
      return !!(this.editor && this.editor.isEditable);
    },
    imageStyle() {
      const style = { "max-width": "600px" };
      if (this.borderWidth) {
        // outline: drawn on the edges without resizing the image, like the report
        style.outline = `${this.borderWidth}px solid #${this.borderColor || DEFAULT_BORDER_COLOR}`;
        style["outline-offset"] = `-${this.borderWidth / 2}px`;
      }
      return style;
    },
  },

  methods: {
    setBorder(width, color) {
      const attrs = {};
      if (width) attrs.borderWidth = width;
      else if (!this.borderWidth) attrs.borderWidth = 2;
      if (color !== null && color !== undefined) {
        const value = String(color).replace("#", "").toUpperCase();
        if (!/^[0-9A-F]{6}$/.test(value)) return;
        attrs.borderColor = value;
      } else if (!this.borderColor) {
        attrs.borderColor = DEFAULT_BORDER_COLOR;
      }
      this.updateAttributes(attrs);
    },

    removeBorder() {
      this.updateAttributes({ borderWidth: null, borderColor: null });
    },

    selectImage() {
      const { state } = this.editor.view;
      let { tr } = state;
      const selection = tr.setNodeMarkup(this.getPos(), undefined, state.doc);
      this.editor.view.dispatch(selection);
    },

    handleImageError() {
      this.imageError = true;
    },

    retryLoad() {
      this.imageError = false;
      this.$forceUpdate();
    }
  },
});
</script>

<style scoped>
.image-frame {
  position: relative;
}
.image-tools {
  position: absolute;
  top: 6px;
  right: 6px;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 1;
}
.image-frame:hover .image-tools {
  opacity: 1;
}
.color-swatch {
  width: 22px;
  height: 22px;
  border: 1px solid #bbb;
  border-radius: 3px;
}
.color-swatch.active {
  box-shadow: 0 0 0 2px #26a69a;
}
</style>
