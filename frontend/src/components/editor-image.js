import Image from "@tiptap/extension-image";
import { Plugin, PluginKey } from "prosemirror-state";
import { Fragment, Slice } from "prosemirror-model";
import { captionAttrs } from "./image-caption";
import { VueNodeViewRenderer } from "@tiptap/vue-3";

import uploadImage from "./uploadImage.vue";
import ImageService from "@/services/image";
import Utils from "@/services/utils";

// Images of pasted content that were not processed yet get their caption trimmed
function trimPastedCaptions(fragment) {
  const nodes = [];
  fragment.forEach((node) => {
    if (node.type.name === "custom_image" && !node.attrs.captionTrimmed) {
      nodes.push(node.type.create({ ...node.attrs, ...captionAttrs(node.attrs.alt, false) }, node.content, node.marks));
    } else if (node.isLeaf || node.isText) {
      nodes.push(node);
    } else {
      nodes.push(node.copy(trimPastedCaptions(node.content)));
    }
  });
  return Fragment.fromArray(nodes);
}

export default Image.extend({
  name: "custom_image",

  addOptions() {
    return {
      ...Image.options,
    };
  },
  group: "block",
  draggable: true,

  addAttributes() {
    return {
      ...Image.config.addAttributes(),
      // Border drawn around the image (editor and report), the image itself is
      // left untouched: removing the border gives back the original
      borderWidth: {
        default: null,
        parseHTML: (element) => {
          const value = parseFloat(element.getAttribute("data-border-width"));
          return value > 0 ? value : null;
        },
        renderHTML: (attributes) =>
          attributes.borderWidth ? { "data-border-width": String(attributes.borderWidth) } : {},
      },
      borderColor: {
        default: null,
        parseHTML: (element) => {
          const value = (element.getAttribute("data-border-color") || "").replace("#", "").toUpperCase();
          return /^[0-9A-F]{6}$/.test(value) ? value : null;
        },
        renderHTML: (attributes) =>
          attributes.borderWidth && attributes.borderColor ? { "data-border-color": attributes.borderColor } : {},
      },
      // Set once the trailing dot of the caption was removed at insertion, so
      // that a dot typed back later is kept
      captionTrimmed: {
        default: null,
        parseHTML: (element) => (element.getAttribute("data-caption-trimmed") === "true" ? true : null),
        renderHTML: (attributes) => (attributes.captionTrimmed ? { "data-caption-trimmed": "true" } : {}),
      },
      attrs: {
        src: {},
        alt: {
          default: "",
        },
      },
      group: "block",
      draggable: true,
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs: (dom) => ({
            src: dom.getAttribute("src"),
            alt: dom.getAttribute("alt"),
          }),
        },
      ],
      toDOM: (node) => ["img", node.attrs],
    };
  },
  addCommands() {
    return {
      setImage:
        (options) =>
        ({ tr, dispatch }) => {
          const { selection } = tr;
          const node = this.type.create(options);

          if (dispatch) {
            tr.replaceRangeWith(selection.from, selection.to, node);
          }

          return true;
        },
      setImageAttrs:
        (attrs) =>
        ({ tr, dispatch, state }) => {
          const { selection } = state;
          const options = {
            ...selection.node.attrs,
            ...attrs,
          };
          const node = this.type.create(options);
          if (dispatch) {
            tr.replaceRangeWith(node);
          }
        },
    };
  },
  addProseMirrorPlugins() {
    //https://github.com/ueberdosis/tiptap/issues/1057
    return [
      new Plugin({
        key: new PluginKey("eventHandler"),
        props: {
          transformPasted(slice) {
            return new Slice(trimPastedCaptions(slice.content), slice.openStart, slice.openEnd);
          },
          handleDOMEvents: {
            drop(view, event) {
              var isImage = false;
              var file = event.dataTransfer.files[0];

              var auditId = null;
              var path = window.location.pathname.split("/");
              if (path && path.length > 3 && path[1] === "audits")
                auditId = path[2];

              // Check first if there are image URLs in the text
              for (let i = 0; i < event.dataTransfer.items.length; i++) {
                const item = event.dataTransfer.items[i];
                if (item.type === "text/plain") {
                  item.getAsString((text) => {
                    if (Utils.isImageUrl(text)) {
                      isImage = true;
                      const { schema } = view.state;
                      const node = schema.nodes.custom_image.create({
                        src: text,
                        alt: "External Image",
                      });
                      const { selection } = view.state.tr;
                      const transaction = view.state.tr.replaceRangeWith(
                        selection.from,
                        selection.to,
                        node
                      );
                      view.dispatch(transaction);
                    }
                  });
                  if (isImage) break;
                }
              }

              // Process image files
              if (file && file.type.startsWith("image")) {
                isImage = true;
                const { schema } = view.state;

                var fileReader = new FileReader();

                fileReader.onloadend = (e) => {
                  Utils.resizeImg(fileReader.result)
                    .then((data) => {
                      return ImageService.createImage({
                        value: data,
                        name: file.name,
                        auditId: auditId,
                      });
                    })
                    .then((data) => {
                      const node = schema.nodes.custom_image.create({
                        src: data.data.datas._id,
                        ...captionAttrs(file.name, false),
                      });
                      const { selection } = view.state.tr;
                      const transaction = view.state.tr.replaceRangeWith(
                        selection.from,
                        selection.to,
                        node
                      );
                      view.dispatch(transaction);
                    })
                    .catch((err) => console.log(err));
                };

                fileReader.readAsDataURL(file);
              }

              if (isImage) {
                event.preventDefault();
                return true;
              }
            },
            paste(view, event) {
              var isImage = false;
              var auditId = null;
              var path = window.location.pathname.split("/");
              if (path && path.length > 3 && path[1] === "audits")
                auditId = path[2];

              // Iterate through all clipboard items to find image URLs
              for (let i = 0; i < event.clipboardData.items.length; i++) {
                const item = event.clipboardData.items[i];
                
                // Check if it's text (potential image URL)
                if (item.type === "text/plain") {
                  item.getAsString((text) => {
                    if (Utils.isImageUrl(text)) {
                      isImage = true;
                      const { schema } = view.state;
                      const node = schema.nodes.custom_image.create({
                        src: text,
                        alt: "External Image",
                      });
                      const { selection } = view.state.tr;
                      const transaction = view.state.tr.replaceRangeWith(
                        selection.from,
                        selection.to,
                        node
                      );
                      view.dispatch(transaction);
                    }
                  });
                  if (isImage) break;
                }
                
                // Check if it's an image file
                if (item.type.startsWith("image")) {
                  var blob = item.getAsFile();
                  isImage = true;
                  const { schema } = view.state;
                  var fileReader = new FileReader();

                  fileReader.onloadend = (e) => {
                    Utils.resizeImg(fileReader.result)
                      .then((data) => {
                        return ImageService.createImage({
                          value: data,
                          name: blob.name || "image",
                          auditId: auditId,
                        });
                      })
                      .then((data) => {
                        const node = schema.nodes.custom_image.create({
                          src: data.data.datas._id,
                          ...captionAttrs(blob.name || "image", false),
                        });
                        const { selection } = view.state.tr;
                        const transaction = view.state.tr.replaceRangeWith(
                          selection.from,
                          selection.to,
                          node
                        );

                        view.dispatch(transaction);
                      })
                      .catch((err) => console.log(err));
                  };

                  fileReader.readAsDataURL(blob);
                  break;
                }
              }

              if (isImage) {
                event.preventDefault();
                return true;
              }
            },
          },
        },
      }),
    ];
  },
  addNodeView() {
    return VueNodeViewRenderer(uploadImage);
  },
});
