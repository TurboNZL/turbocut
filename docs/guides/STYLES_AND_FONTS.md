# Caption styles and fonts

## Styles
A **style** is a pack of looks (variants, for example white, yellow, red) plus an entrance animation. Captions → *Edit styles…* opens the editor with a live preview that uses the same drawing code as the player and the export.

- The built-in style is read-only and follows your default font and letter-hole setting. **Duplicate to edit** makes your own copy.
- Per variant: font, size, bold, italic, fill colour, outline colour and width, position, and what the holes of letters look like.
- **Letter holes**: *Filled* paints every hole (o, e, a, g, 8) solid with the outline colour, the classic look and the default. *Thin rim* keeps a thin outline inside and leaves the middle open. *Clear* shows the picture through the holes.
- The entrance is a bounce (length in frames and overshoot) or none.

## Sharing a style
*Export style* writes a small JSON file. The fonts the style uses are **included by default** so it looks the same on another device; untick *Include fonts* for a smaller file. *Import style* installs the style and its fonts. Only share fonts you have the right to redistribute.

## Fonts
Settings → Fonts (or Captions → Fonts…) is the font manager:
- **Add** font files (.ttf, .otf, .woff, .woff2). Adding the same font again replaces it.
- Each font is shown drawn in itself, with where it is used.
- **Make default**: the default font is used by the built-in style, new styles and new text layers.
- **Remove** a font; styles that used it fall back to a plain font until you add it again.
- A *Missing on this device* box lists fonts that styles ask for but this device does not have.

TurboCut ships no third-party fonts. Fonts you add stay on this device.
