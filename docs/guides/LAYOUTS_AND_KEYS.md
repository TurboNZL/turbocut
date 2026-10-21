# Layouts, shortcuts and snapping

## Layouts
Settings → Layout. Pick a **preset** and it applies at once; there are four: *Automatic* (one panel on the right, a bottom sheet on a phone), *Library and editor* (Media and Project on the left, Clip and Captions on the right), *Stacked panels* (two named panels in one column) and *Bottom sheet*. Change anything and TurboCut makes **your own copy**, so the presets stay as they were. Your layouts can be renamed, deleted, exported and imported as small files.

- **Panels.** Each panel is its own named box with its own tabs, on the **left** or the **right** of the preview. Settings → Layout → Panels lists them: give each a name, choose its side, tick the tabs it holds (a tab lives in one panel; a tab in no panel is hidden) and press *Add a panel*. Panels on the same side stack and show their names.
- **Resizing:** drag the bar at the edge of a panel, the bar between two panels, or the bar above the timeline (it is as wide as the timeline). Double-click a bar to reset it.
- **Panel behaviour:** *Tab that opens first* is Media unless you change it; *Switch tabs when you select something* (on by default) shows Clip when you select a clip and Captions when you select a caption.
- **Editing tools** (Split, Trim, Delete, Text, Snap, zoom): Settings → Layout → **Editing tools** → *Position*. *Automatic* puts them in line with the play button on a computer (Trim start, **Split**, Trim end, then the rest) and under the timeline, centred, on a phone. Other choices: in line with the play button (on a phone a row just under it), **a row of their own** under the play button, under the timeline, **a column left or right of the preview** (computers only), or **round floating buttons at the bottom right** (the round button folds them away). With panels on both sides the bar drops to its own row and hides its labels when there is not enough room.
- **Bottom dock** (Home, Edit, Settings): a switch in the same page under *Panel behaviour* (it is also in Settings → Look).
- **Preview on a phone.** Settings → General → Preview: *Automatic* draws at most 640 px on the long side and 30 frames a second on a phone, which keeps playback smooth. Choose a higher setting if your phone keeps up.
- **On a phone** (or a narrow window) everything is one panel under the timeline. The timeline stays in view when the panel is open; the preview gives up room instead.
- **Window:** Settings → Look → Window has the **bottom dock** (Home, Edit and Settings as three pages; Settings becomes a page instead of a window) and, in the desktop app, whether the title bar is drawn by the theme.

## Settings
Settings is grouped (Editor, Captions and text, App) and has a **search** box at the top, ready to type in as soon as Settings opens: type a word and only the matching settings show, from every page.

## Shortcuts
Settings → Keys lists every action. Click a shortcut to remove it, **Add** to record another, **Reset** to go back. A conflicting key is reported instead of silently stolen. **?** opens the list. Hovering a button shows the shortcut you have set for it, not the default.

Useful defaults: **Space** play, **S** split, **[** and **]** trim to the playhead, **K** keyframe, **,** and **.** previous and next keyframe of the setting you last touched (each setting, such as Scale or Opacity, has its own prev/next/key buttons and its own row of diamonds in the Clip tab), **N** snapping, **M** mute.

## Cutting and selecting
- Only one kind of thing is selected at a time: clips **or** a caption. Click empty space on a track, or press **Esc**, to select nothing. **Drag a box** over empty track space to select every clip it touches (hold Shift or Ctrl to add to what is selected); a plain click on empty space moves the playhead there.
- Clicking a caption selects it and leaves the playhead where it is, so Split cuts where you put the playhead.
- **Right-click** a track name for its options (hide, mute, lock, delete); a left click just picks the track.
- **Split** (S) cuts at the playhead: the selected clip and its linked picture or sound; the selected caption (between its words, so both halves read right; a one-word caption cannot be split); or, with nothing selected, the clips on the **active track** (the one you last clicked). Click **CC** to make the caption row the active track. Other tracks are left whole.
- **Delete** removes what is selected, never something else.

## Snapping
Clips and edges jump to the playhead and to each other when dragged close. Turn it off with **N**, the magnet button or Settings → General.

## Zoom
Pinch on a touch screen; Ctrl or Alt + mouse wheel on a computer (zooms around the pointer); the zoom buttons in the edit bar. The plain mouse wheel scrolls the timeline sideways; Shift + wheel scrolls the tracks up and down.
