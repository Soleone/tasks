# Toolbar

One compact row above the list, in this order:

```text
[ Category ] [ Status ] [ Priority ] [ Tags ] [ Unblocked ] [ Search ]  [ Created Updated Priority Manual Reverse ]  [ Details Move ]
```

Each button shows its value through its pressed state, label and tooltip. Filters, search and sort are remembered between launches.

| Rule | When | Then |
| --- | --- | --- |
| `toolbar.layout` | Space is narrow | Filter and Sort headers align in the same column, leaving space below New task. Groups wrap intact without horizontal overflow. The group containing Details and Move is named Actions |

## Touch feedback

| Rule | When | Then |
| --- | --- | --- |
| `toolbar.touch-feedback` | Tapping Unblocked, a sort option, Reverse or Details with touch | The action runs immediately and a tooltip above the button confirms the resulting state for 1.5 seconds. The next interaction dismisses or replaces it, without taking focus. Disabled controls do not show feedback. Desktop hover is unchanged; buttons that open menus or pickers do not add tap feedback |

## Count line

| Rule | When | Then |
| --- | --- | --- |
| `count.line` | Any list state | One muted line under the toolbar reports the matching count and active filters, e.g. "12 active tasks". It never mentions sort and truncates instead of wrapping |
| `count.clear-one` | Clicking a filter in the count line | Only that filter resets |

## Focus modes

| Rule | When | Then |
| --- | --- | --- |
| `filter.mode` | `F` | The filter group takes focus with a visible ring. The next key picks a filter |
| `sort.mode` | `S` | The sort group takes focus. The next key picks a sort |
| `toolbar.mode-exit` | Choosing an option, pressing the same key again, `Escape`, leaving the app or hiding the page | Focus returns to the list. There is no timeout |
| `toolbar.dialog-return` | A category, tag or search dialog opened from a mode closes | Focus returns to the list |

## Filters

| Rule | When | Then |
| --- | --- | --- |
| `filter.status-toggle` | `F` `S` | Switches between active (open, in progress) and inactive (paused, done, canceled). Active is the default |
| `filter.status-exact` | `F` then `O` / `I` / `D` / `P` / `X` | Shows only Open / In progress / Done / Paused / Canceled |
| `filter.priority` | `F` then `0`–`4` | Shows only that priority. The same key again clears it |
| `filter.unblocked` | `F` `U` | Hides tasks with any blocker. A done blocker still blocks; a canceled one doesn't |
| `filter.category` | `@`, or `F` `C` | Category picker with its search focused. One category at a time. Categories used only by canceled tasks are left out |
| `filter.tags` | `#`, or `F` `T` | Tag picker. Tags combine with AND. `Space` toggles, `Enter` picks the highlighted tag when none is picked, then closes. A Clear tags row empties the filter. Tags used only by canceled tasks are left out |
| `filter.search` | `/` | Search over titles and descriptions. The query stays applied after the dialog closes |
| `filter.escape` | `Escape` on the list with one or no task selected | All filters and search reset. Sort and Details stay |

## Sort

| Rule | When | Then |
| --- | --- | --- |
| `sort.default` | First launch | Created, newest first |
| `sort.created` | `S` `C` | Created date |
| `sort.updated` | `S` `U` | Updated date |
| `sort.priority` | `S` `P` | Priority, P0 first |
| `sort.manual` | `S` `M` | Manual order, the order shared with the CLI and agents |
| `sort.reverse` | `S` `R` | Reverses date or priority order. Not available for Manual |
