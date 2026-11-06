# Changelog

## [0.4.3](https://github.com/Soleone/tasks/compare/v0.4.2...v0.4.3) (2026-11-06)

### Features

* filtering by category pushes the other tasks off the list's edge and settles the rest into place ([444d2b0](https://github.com/Soleone/tasks/commit/444d2b0e0452167b12d473214a4d7f445d916676))

## [0.4.2](https://github.com/Soleone/tasks/compare/v0.4.1...v0.4.2) (2026-11-05)

### Features

* descriptions and images get their own In detail quest, Fast hands keeps the quick edits, and Make it yours ends with where to look when you forget a key ([6c1f885](https://github.com/Soleone/tasks/commit/6c1f885938267949a2eb81bfb9384d533a91083e))
* the due lens turns the list over like a calendar page, and a short list turns about its own rows ([5dd53c5](https://github.com/Soleone/tasks/commit/5dd53c5d79bcfdf9e51fbcbdb2ddfe67ad7fb436))
* the Fast hands quest teaches A for the active task's menu ([a4fd784](https://github.com/Soleone/tasks/commit/a4fd784d4d0fadfcda314e8d6179783bd654574d))
* the list flips over when the done lens opens or closes, and the done count flies into the count line ([645d9aa](https://github.com/Soleone/tasks/commit/645d9aaecf71bb53c801b644be2fb8f679d29637))

## [0.4.1](https://github.com/Soleone/tasks/compare/v0.4.0...v0.4.1) (2026-11-04)

### Features

* A or the Menu key opens the active task's menu, which arrows and Enter drive ([d15a66f](https://github.com/Soleone/tasks/commit/d15a66f7693bbed366027ac602360d4b026a402a))
* the task menu's Status submenu sets any status directly, so an in-progress task can go back to open ([7374f3d](https://github.com/Soleone/tasks/commit/7374f3d9c6f1df571beec57f1935ca1d0dc21897))

### Bug Fixes

* a double click in Delete canceled tasks lands on Cancel, and Delete done tasks marks plain Delete as the destructive choice ([a7a6aca](https://github.com/Soleone/tasks/commit/a7a6aca4054f3d36d2f556fa0883b86df1f7b189))
* an in-progress task with an effort badge keeps its arrowhead instead of looking like a broken ring ([d741769](https://github.com/Soleone/tasks/commit/d741769e264ecb103ab06abc6bbbf34f4503c369))
* the status menu no longer shows in progress in the high-priority yellow ([279a5df](https://github.com/Soleone/tasks/commit/279a5df9a3521f00f2f8c5fd10ca372305ef5916))

## [0.4.0](https://github.com/Soleone/tasks/compare/v0.3.8...v0.4.0) (2026-11-01)

### Features

* category and tag lists show the ones you used most recently first ([319b6d5](https://github.com/Soleone/tasks/commit/319b6d59fb7c8c8fe5d5c802a596bc66f1986825))
* **cli:** tasks-cli works on the home the app opens, without --home ([18f565f](https://github.com/Soleone/tasks/commit/18f565f07c993383a634870d86e26de49950e978))
* confirmations flash in a tooltip instead of resizing Settings, and toasts show above dialogs ([432f81d](https://github.com/Soleone/tasks/commit/432f81d137dedd54c107c91ae6b953b7a8a21505))
* effort chevrons nudge the way their level points and fold flat on the way back to normal ([c843a54](https://github.com/Soleone/tasks/commit/c843a54b26ea0385d834cd2d657cf42fdb84f7d0))
* send bugs and feedback from Settings, no GitHub account needed ([0711e39](https://github.com/Soleone/tasks/commit/0711e39e3361578b09a4e2a5365f5ecbeeff562b))
* set a task's priority from its long-press menu and Task actions ([9830c4b](https://github.com/Soleone/tasks/commit/9830c4b2e933f7f5139adeac439532e1ca0ee7b5))
* step priority with [ and ], and effort moves to , and . to match its chevrons ([97ad2f4](https://github.com/Soleone/tasks/commit/97ad2f4486d664895a61fa60247c56e2e1c6c3e6))
* thinner focus rings across the app, crisp focus on Settings tabs, and a lighter kind choice in Send feedback ([035281c](https://github.com/Soleone/tasks/commit/035281c55a1cda4ab5c199b8a4de6fc1fd449716))
* try Tasks in the browser, no install ([dd958e2](https://github.com/Soleone/tasks/commit/dd958e2c0a372d03989cd769bff18e982ab379c3))
* **web:** a switch shows the example tasks, and a button downloads the app ([a22649f](https://github.com/Soleone/tasks/commit/a22649ffe45cd5b60c9ee684c543513f36b912b1))
* **web:** example tasks wait behind a button, next to a download link ([8ed8151](https://github.com/Soleone/tasks/commit/8ed81518ef3dfb3cbc432b0af53e37ec6ce58872))

### Bug Fixes

* a narrow task editor no longer leaves an empty line under the title ([a044132](https://github.com/Soleone/tasks/commit/a0441320e48a2fa26573494f9ff438f0495e1aac))
* on a narrow screen the task editor keeps the category on the title line, as in the list ([98d13ca](https://github.com/Soleone/tasks/commit/98d13caed6a38fc7f7f32eaa4e7b9c5967029016))
* **styles:** rotate in-progress icon 180 degrees ([35efeb6](https://github.com/Soleone/tasks/commit/35efeb638a092f826597bcd49dfe9d41cbabc3e7))
* switching Settings tabs no longer leaves the last tab's buttons showing for a moment ([88ef457](https://github.com/Soleone/tasks/commit/88ef457016eba6d9f3900a36eaaaa60767d5119d))
* the category column fits your longest category and lines up with the editor ([21d7a7b](https://github.com/Soleone/tasks/commit/21d7a7bdaef7561e174a6c3edb91c4e01b47f41d))

## [0.3.8](https://github.com/Soleone/tasks/compare/v0.3.7...v0.3.8) (2026-10-31)

### Bug Fixes

* completed tasks always slide out and send their check to the done count ([c599ffe](https://github.com/Soleone/tasks/commit/c599ffe9593f4178388232562a90f208c4c41f13))
* **macos:** done checks and count rolls no longer skip their animation ([0d39dfc](https://github.com/Soleone/tasks/commit/0d39dfc77cf8fdc897d9be52b7005553ef3b0d73))

## [0.3.7](https://github.com/Soleone/tasks/compare/v0.3.6...v0.3.7) (2026-10-31)

## [0.3.6](https://github.com/Soleone/tasks/compare/v0.3.5...v0.3.6) (2026-10-31)

### Features

* **release:** automate cross-platform tagged releases ([748339c](https://github.com/Soleone/tasks/commit/748339c4c7d9c91a9ab37d5d24f2dfef3decd418))

## [0.3.5](https://github.com/Soleone/tasks/compare/v0.3.4...v0.3.5) (2026-10-30)

### Features

* **desktop:** global hotkeys to bring Tasks forward and capture a task ([e5114bb](https://github.com/Soleone/tasks/commit/e5114bb1f336cad8b467bbd22966565d536d7051))
* **tasks:** slam newly captured tasks onto the list ([d43adfd](https://github.com/Soleone/tasks/commit/d43adfd148aba0a31a6d8f2a8789fe89706f2d55))

### Bug Fixes

* **help:** name Option and ⌘ on a Mac, and let ⌥+T open themes ([3ff4561](https://github.com/Soleone/tasks/commit/3ff45619bf177c8cae12c2c1556a77d8e592e021))

## [0.3.4](https://github.com/Soleone/tasks/compare/v0.3.3...v0.3.4) (2026-10-29)

### Features

* **learning:** reorder the quests so each one teaches one thing ([3a6b8d9](https://github.com/Soleone/tasks/commit/3a6b8d986ba97d26cc054e60389b7c37048a922b))
* **task-list:** mark how big a task is with effort ([5889eb8](https://github.com/Soleone/tasks/commit/5889eb8d4befa2b4ced055ee0d6ac5811552f4bb))

### Bug Fixes

* **learning:** touch quests say Save, the button's actual label ([2f644a0](https://github.com/Soleone/tasks/commit/2f644a02c014fdf5225c2564fb6d5bd40d51c08e))

## [0.3.3](https://github.com/Soleone/tasks/compare/v0.3.2...v0.3.3) (2026-10-29)

### Features

* **filters:** add all-statuses preset to status filter ([3167d2c](https://github.com/Soleone/tasks/commit/3167d2caa2bead61884df605ac0109520b8d2122))
* fly completed checks to the done-today count ([101374a](https://github.com/Soleone/tasks/commit/101374a1b8bf848d52cebfcac17cef1c56eb030a))
* **home:** fly a row's category into the filter badge ([c74db12](https://github.com/Soleone/tasks/commit/c74db1262cbbe3cd85531b64e89fb3afddaa180b))
* **layout:** widen desktop app shell max width ([7c1df88](https://github.com/Soleone/tasks/commit/7c1df88b16ee1050c7693073e08835569b1436a1))
* **task-list:** show priority on done tasks ([27ae532](https://github.com/Soleone/tasks/commit/27ae5326fb9fefb021f29b04053c9d42402924ed))
* **task-list:** switch or cancel inline edit on outside click ([4bc1725](https://github.com/Soleone/tasks/commit/4bc1725c27ac66fa2a5e60bf2096543c378d4442))
* **tasks:** give newly captured tasks a distinct save animation ([4fc55b0](https://github.com/Soleone/tasks/commit/4fc55b0ae79185b22ccf3a16090eabd876248748))

### Bug Fixes

* **settings:** keep dialog height fixed across tabs ([de2ef9d](https://github.com/Soleone/tasks/commit/de2ef9dba30c7aaafb3e460ea6b346549e2e527e))

## [0.3.2](https://github.com/Soleone/tasks/compare/v0.3.1...v0.3.2) (2026-10-29)

### Features

* **ui:** priority redesign with accent colors for high and muted visuals for low ([6473e31](https://github.com/Soleone/tasks/commit/6473e319dd5a7f4310908c75981127f73359bd5e))

## [0.3.1](https://github.com/Soleone/tasks/compare/v0.3.0...v0.3.1) (2026-10-28)

### Features

* **android:** add and share task images ([1e9eee5](https://github.com/Soleone/tasks/commit/1e9eee5b354b316dc4b88c63d208d3dd265c1788))
* **composer:** fly category filter badge into new task pill ([233157e](https://github.com/Soleone/tasks/commit/233157e065c840f331550150fb4fcc1281f6ba9f))

## [0.3.0](https://github.com/Soleone/tasks/compare/v0.2.2...v0.3.0) (2026-10-28)

### Features

* **due:** use ! as the due-date shorthand marker ([92ffe7b](https://github.com/Soleone/tasks/commit/92ffe7b89fba0680d98a2cb1488b026e9bdf33ab))
* **editor:** add save key to touch keyboard bar ([2e58652](https://github.com/Soleone/tasks/commit/2e5865210a1651606233ec454ac3a5a245db5b4f))
* **editor:** keep the due date and category where the row shows them ([36a3952](https://github.com/Soleone/tasks/commit/36a39521caebfb98c062e59ddd9a180dfec232f1))
* **editor:** light up a pill's letters as its name is typed ([6f8a17a](https://github.com/Soleone/tasks/commit/6f8a17a74ff9c0fc022c41aa52857b0d470a519d))
* **editor:** show a sweep and check on saved rows ([4a8df8c](https://github.com/Soleone/tasks/commit/4a8df8cad71dcbd741c0bb8976a86cb8da8420be))
* **lenses:** move due-now lens shortcut from N to ! ([d60b381](https://github.com/Soleone/tasks/commit/d60b3811f5a3f63102c84b1459c6c99b9ca8d181))
* **styles:** animate strike-through on canceled task titles ([eb24143](https://github.com/Soleone/tasks/commit/eb24143fc748c4822ce097aba4e4d70f1e231022))
* **task-list:** filter by a tag when it is clicked ([985cb20](https://github.com/Soleone/tasks/commit/985cb20f1e6d40efc31420a5a87ef3bdd1a5baae))
* **task-list:** line up due dates by keeping the arrow slot ([6ca56bb](https://github.com/Soleone/tasks/commit/6ca56bb7689bd6dd43e9cd4f13d3e22b34b1e955))
* **task-list:** show tags as quiet text after the title, also in the editor ([ad7f402](https://github.com/Soleone/tasks/commit/ad7f402f97e2585d463ad379ee397384edeb9c45)), references [#tag](https://github.com/Soleone/tasks/issues/tag)
* **task-list:** show the category in a column at the row's end ([be281d8](https://github.com/Soleone/tasks/commit/be281d845051f223e9d8256800f067a1a91b5d09))

### Bug Fixes

* **ui:** show the platform's modifier key in shortcut hints ([2cd9909](https://github.com/Soleone/tasks/commit/2cd9909ba96a99b3a67fe55fc3d685065b448ed7))

## [0.2.2](https://github.com/Soleone/tasks/compare/v0.2.1...v0.2.2) (2026-10-27)

### Features

* **learning:** expand quests and add a first-use welcome ([1f662e0](https://github.com/Soleone/tasks/commit/1f662e0b660ffa7592b5542329c5902358adc390))
* **updates:** Omarchy Linux gets an AppImage that updates itself and shows in the app menu ([0e7fda5](https://github.com/Soleone/tasks/commit/0e7fda511841e67efed0edc5031f1fc4e57c6698))

## [0.2.1](https://github.com/Soleone/tasks/compare/v0.2.0...v0.2.1) (2026-10-27)

### Features

* **updates:** the Windows app offers and installs new releases itself ([557f68d](https://github.com/Soleone/tasks/commit/557f68db22040b37a5b2ff45a9cce157c05313b1))

## [0.2.0](https://github.com/Soleone/tasks/compare/v0.1.0...v0.2.0) (2026-10-27)

### Features

* **release:** versioned releases on GitHub ([3e891a9](https://github.com/Soleone/tasks/commit/3e891a9788faccab3f6c790aeab2ca56bce55dad))
