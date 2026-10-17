# Automatic captions

Captions tab → *Generate captions* turns the speech in your timeline into timed captions. Pick the engine in Settings → Captions.

## Engines
- **On this device**: a Whisper model runs in the browser (WebGPU where available, otherwise slower WebAssembly). The model is downloaded once and kept. Nothing leaves the device.
- **A server on my network**: a computer with a graphics card does the work and the phone only sends audio. Enter its address (and token if it has one). Good for long videos and weak phones.

## Settings that matter
- **Language** is English by default. Automatic detection on a multilingual model sometimes chose the wrong language and invented text; set the language you speak.
- **Model**: bigger models are more accurate and slower to download and run. The first time you press *Generate captions* on this device TurboCut asks which one to download: **Accurate** (about 250 MB) is preselected on a computer, **Balanced** (about 80 MB) on a phone. Change it later in Settings → Captions.
- **Caption length**: *Automatic* gives short lines of a few words for tall video and whole sentences for wide video. Pick *Short lines* or *Whole sentences* to force one.
- **Processor**: *Automatic* tries WebGPU first. If captions look wrong, try the other one.

## What TurboCut cleans up for you
Whisper sometimes writes words where nobody speaks, repeats a phrase in a loop, or gives times past the end of the video. TurboCut removes words that fall after the last frame, words over silence, and repeated loops, and tells you how many it removed. If nothing real is left it says so instead of adding nonsense.

## When captions look wrong
1. Check the language.
2. Try the Accurate model, or the other processor. The small models time words loosely and mishear more.
3. Press *Copy captions report* and send it: it lists the model, the processor, the audio level and the first words exactly as the model returned them.

## Editing
Every caption is a row: change the text, pick a style variant (for example another colour for emphasis), jump to it, or delete it. To cut a caption in two, select it (in the list or on the CC row), put the playhead where you want the cut and press **S**. *Import .ass* and *Export .ass* exchange captions with other editors; the entrance animation is baked into the file so other players show the same bounce.
