# Animation Injector Editor · 1.0.0

A Windows program for making action mods for [Animation Injector](https://github.com/skypia0147-dev/Animation-Injector). Place HKX files as cards and connect them to build actions (done alone or as pairs), then export the XML the game reads or a mod folder.

## Requirements

- Windows 10/11 x64 and the Microsoft Edge WebView2 Runtime (included in Windows 11)
- In game: **Animation Injector 1.0.0 or later** and its requirements
- Keep the included `AnimationInjectorXmlCheck.exe` in the same folder as `AnimationInjectorEditor.exe`. When you save, it checks that the game can read the XML. Without it the editor saves unchecked and shows a warning.

## Getting started

1. Make a **New Project**, or open a saved XML or template (`.aitemplate`). Dropping a file on the window opens it too.
2. Make a card with **＋ Play HKX** in the toolbar and pick its HKX under **File**. Keep HKX files under `meshes\actors\<character or creature folder>`, with only English letters, digits and common symbols in the path (the game cannot find files under non-English paths). The Action ID is taken from the HKX file name.
3. Right-click the card and choose **Add start key input** or **Add start event** to set how the action starts.
4. Add features such as invulnerability, stagger resistance, turning, costs and strikes with **+ Feature** on the card. Features that stay on for the whole action and ones that run at a moment share one list.
5. To lead to the next action, right-click the card, choose **Add transition key input** or **Add transition event**, then drag its output pin to the next card or pick it from the **▾** list.
6. Check with **F7** and save with **Ctrl+S**. Clicking an item in the error list takes you to its card.

## Working with the graph

- Inputs, events, conditions, QTEs and transitions all share one canvas. Double-click a card to show only that action's flow.
- **Arrange ▾**: arrange all, arrange the selected actions, summary or expanded view.
- Drag on an empty area to select several cards. Shift adds, Ctrl toggles, Space+drag pans.
- Selecting a card highlights the lines connected to it.
- Several HKX can share one event transition card: drop an HKX's output pin on an existing transition card to use the same transition.
- A transition three or more HKX share is shown as a **→ Transition ①** mark on each HKX card instead of lines. Its lines appear while that HKX or the transition card is selected; click the mark to select its line, and Delete cuts it.
- A **condition card** picks the action to go to by the situation (weapon, movement direction, being in the air, the previous action, the hit just taken, weather and more); a **QTE** sets the next action for each result (success, failure, perfect).
- The **Event registry** card gathers the event names the project uses and what each event does.
- A key input is a key and pad button set directly, or a game control (Jump, Sprint, Sneak, ...). A game control follows the player's key bindings.

## Saving and exporting

- **Save (Ctrl+S)** writes the XML the game reads. Editing information such as card positions goes into the same file, so you can open it again and carry on.
- Opened on another computer, it finds the HKX and sound files in the XML's mod folder again by itself.
- You can save with errors, but the game does not read the file until you fix them and save again (for a file saved before, the game keeps its last good content).
- If the file was changed outside the editor, it asks before overwriting.
- **Export → XML (Ctrl+E)** saves a separate XML when there are no errors.
- **Export → Mod folder (Ctrl+Shift+E)** makes a folder you can install with a mod manager, holding the XML and the HKX and sound files it uses. Files other mods or the game provide are marked. It does not overwrite a folder of the same name.
- **Sounds** in the browser panel gathers the sound files of the mod folder. ▶ plays them (.wav), and they are copied along when you export the mod folder.

## Viewer

**Window → Viewport** plays the selected HKX. Preview skeletons and skins for people and creatures are included, so it plays right away. To use another skeleton, set it under the viewport's **Preview assets**.

- Middle-drag: orbit · Shift+middle-drag: pan · Wheel: zoom · Ctrl+wheel: field of view

The viewer does not reproduce the game's collision, physics and so on. Check the final result in game.

## Shortcuts

| Key | Action |
|---|---|
| Ctrl+N / O / S | New project / Open / Save |
| Ctrl+Shift+S | Save as |
| Ctrl+E / Ctrl+Shift+E | Export XML / Export mod folder |
| F7 | Check |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+A · Delete | Select all · Delete |
| Home | Fit view |
| Ctrl+` | XML preview |

## Language and autosave

- Switch between English, 한국어, 日本語 and 中文 in the **Language** menu.
- Your work is autosaved. After a crash, bring it back with **Recover autosave** on the start screen.

## License

GPL-3.0 (`LICENSE`). Third-party notices are in `THIRD_PARTY.md` and `THIRD_PARTY_NOTICES.txt`. Source code: https://github.com/skypia0147-dev/Animation-Injector-Editor
