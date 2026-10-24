# Animation Injector Editor · 1.0.0

A Windows program for building Animation Injector (SKSE) actions, ordinary and paired, as a graph of cards, and exporting them as the XML the game reads or as a mod folder.

## Requirements

- Windows 10/11 x64 with the Microsoft Edge WebView2 Runtime (included in Windows 11)
- In game: **Animation Injector 0.12.289 or later** ([GitHub](https://github.com/skypia0147-dev/Animation-Injector)) and its requirements
- Keep `AnimationInjectorXmlCheck.exe` (included) in the same folder as `AnimationInjectorEditor.exe`. Saving runs the same check as the game's runtime, so the editor never writes an XML the game would skip entirely. Without it the editor saves unchecked and warns you.

No development tools (Node.js, Rust, Python) are needed.

## First action

1. Create a **New project**, or open an XML or template (`.aitemplate`); dropping one on the window also opens it. Examples are in the `examples` folder.
2. Add a card with **＋ Play HKX** on the toolbar and choose its HKX under **File**. The HKX must be below `meshes\actors\<character or creature folder>`, and the path below that folder may use only ASCII letters, digits and common symbols: the game cannot find files with other characters in their path.
3. Right-click the card and choose **Add start key input** or **Add start event** to decide how the action starts.
4. Use **+ Feature** on the card for invulnerability, stagger immunity, rotation, resource cost, camera restore and more. Features that last the whole action and ones at a given moment share one list.
5. To continue into another HKX, right-click the card, choose **Add transition key input** or **Add transition event**, then drag the output pin to the next card or pick it from the pin row's **▾** list.
6. Check with **F7** and save with **Ctrl+S**. Clicking an entry in the error list takes you to its card.

## Working with the graph

- Inputs, events, conditions, QTEs and transitions all live on one canvas. Double-click a card to see only that action's flow.
- **Arrange ▾**: arrange everything, arrange the selected action, summary or expanded cards.
- Drag on empty space to select cards (touching is enough). Shift adds, Ctrl toggles, Space+drag pans.
- Selecting a card highlights its links. Uncoloured links turn light blue when they leave the card and pink when they come in; links that already have a role or result colour keep it, brighter and thicker.
- An HKX card's settings and features are edited on the card; the Details panel on the right lists that action's problems, links and HKX file.
- A **condition branch** routes pass and fail; a **QTE** sets continue, event or transition for each result (success, failure, perfect).
- The **Event registry** card gathers the project's event names and what they do.

## Saving and exporting

- **Save (Ctrl+S)** writes the XML the game reads, with the editor's data (card layout, shared settings and so on) in a comment at its end. The game skips the comment; opening the XML again continues where you left off.
- The editor's data holds no paths of your computer (HKX sources, search folders, preview assets). On this computer they come back when you reopen the file; on another one, HKX in the XML's own mod folder are found again automatically.
- You can save with errors. A file saved before keeps the last valid part the game reads and only the editor's data is updated. A file saved for the first time keeps only the editor's data, with the part the game reads left empty: the game skips that file until you fix the errors and save again.
- If the file changed outside the editor (another editor window, a text editor, a sync tool), the editor asks before writing over it.
- **Export → XML (Ctrl+E)** saves a separate XML when there are no errors.
- **Export → Mod folder (Ctrl+Shift+E)** writes `<mod name>\SKSE\Plugins\AnimationInjector\<mod name>\<mod name>.xml` and the HKX it uses. Choose search folders to check the assets; HKX another mod provides are marked as external. An existing folder of the same name is never overwritten.
- XML of older formats (version 1 to 3) and templates with combos do not open. Build them again in the editor and save.

## Viewer

**Window → Viewport** plays the selected HKX. The release package includes preview skeletons and skins for humans and creatures, so supported HKX play right away. A build from source has none: choose a skeleton HKX (for example `meshes\actors\character\character assets\skeleton.hkx`) under the viewport's **Preview assets**. It is remembered on this computer, and a skeleton under the same mod's `actors` folder is found automatically. Without a GLB skin the viewer draws the bones.

- Middle-button drag: orbit · Shift+middle-button drag: pan · Wheel: zoom · Ctrl+wheel: field of view

The viewer does not simulate the game's OAR selection, IK, collision or physics. Check the final result in game.

## Shortcuts

| Keys | Action |
|---|---|
| Ctrl+N / O / S | New project / Open / Save |
| Ctrl+Shift+S | Save as |
| Ctrl+E / Ctrl+Shift+E | Export XML / Export mod folder |
| F7 | Compile (check) |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+A · Delete | Select all · Delete |
| Home | Fit view |
| Ctrl+` | XML preview |

## Language and autosave

- The **Language** menu switches between English, 한국어, 日本語 and 中文 at once. Names you typed do not change.
- Work in progress is kept automatically. After a crash, **Recover autosave** on the start screen brings it back.

## License

GPL-3.0 (`LICENSE`). Third-party notices are in `THIRD_PARTY.md` and `THIRD_PARTY_NOTICES.txt`. To build from source, see `BUILDING.md`.
