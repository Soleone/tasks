# Changelog

## [0.6.2](https://github.com/Soleone/tasks/compare/v0.6.1...v0.6.2) (2026-11-13)

### Features

* **keys:** change any shortcut in Settings › Keys ([758ac36](https://github.com/Soleone/tasks/commit/758ac361ccf74a0bfd5f1b7f2f15b523936b4a1d))
* **notes:** continue lists on Enter and tick checklist boxes from the list ([0f32f2b](https://github.com/Soleone/tasks/commit/0f32f2babb2c8c9f1a293b62c407eabf713c2479))
* **notes:** show list dashes as dots and GitHub-style checklists as boxes ([24fcfa7](https://github.com/Soleone/tasks/commit/24fcfa7cc9d6a440fd8f37221ffe88e9e2d3ddec))
* **notes:** show list items, bold, italic and named links in a task's notes ([fda90ff](https://github.com/Soleone/tasks/commit/fda90ffee33a118d1f4991396b9db0b1a9d1f915))
* **notes:** style Markdown in the description while you type ([97a3e11](https://github.com/Soleone/tasks/commit/97a3e11f9b96d26f263ad689dcf3e286b5c42479))
* **notes:** tick checklist boxes while editing a description ([bf7531c](https://github.com/Soleone/tasks/commit/bf7531cad4336683dacae8857f973d7c549f0e01))

### Bug Fixes

* **keys:** show the reset hint as a tooltip instead of a native title ([ec41b60](https://github.com/Soleone/tasks/commit/ec41b60d1dc1fd60eb4cf38a80cc3bcb929ddee9))
* **notes:** close the gap between a checklist box and its text ([ea067e8](https://github.com/Soleone/tasks/commit/ea067e8da68684db8d00cec5c835b60c60cd12f9))
* **notes:** line checklist boxes up with list dots, and keep notes in place when editing ([f3e63c9](https://github.com/Soleone/tasks/commit/f3e63c952c91101d2009abc51ddbf8f2fe1fd833))
* **notes:** underline links in the description while editing ([b15f7cb](https://github.com/Soleone/tasks/commit/b15f7cb310496e779829b5add542c3d025077d52))

## [0.6.1](https://github.com/Soleone/tasks/compare/v0.6.0...v0.6.1) (2026-11-12)

### Features

* **android:** map system back to Escape instead of swipe ([bae63d9](https://github.com/Soleone/tasks/commit/bae63d9640bb62a758efbb7149f6bda4d6ff56a7))

### Bug Fixes

* **list:** a completed row finishes sliding out even when the app is busy ([9d4a834](https://github.com/Soleone/tasks/commit/9d4a83471ee5023dcfaf0bbd1bd1318ee0489a0f))

## [0.6.0](https://github.com/Soleone/tasks/compare/v0.5.3...v0.6.0) (2026-11-12)

### Features

* **agents:** show the CLI's path in Settings and copy instructions for an agent ([ffc69e4](https://github.com/Soleone/tasks/commit/ffc69e4603d50a47137c821128b76242ba8df006))
* **agents:** show which tasks agents changed with the CLI since you last looked ([a3c9618](https://github.com/Soleone/tasks/commit/a3c9618cb616e9f239fbdf0b177f9756fcbad177))
* **android:** New task from the app icon's menu, and share text, links or images into a new task ([dd68a29](https://github.com/Soleone/tasks/commit/dd68a295e3410a78f2282aa85d5b63b0806990f8))
* **crash:** a screen error shows what happened with Reload and a prefilled bug report instead of a blank window ([4b84e38](https://github.com/Soleone/tasks/commit/4b84e38bb3cc500a28f5c8ce7621f8c0f310af62))
* **export:** download all tasks as a zip from the web version ([2994070](https://github.com/Soleone/tasks/commit/2994070a0217fe76e0ffb306bf78606afd808d6a))
* **export:** save all tasks and images as one zip from Settings ([e216a44](https://github.com/Soleone/tasks/commit/e216a4439a5d9d8bed83cc85ee2530bb9b9703f6))
* **notes:** open web links in a task's notes, by click or with O ([d8e9b4b](https://github.com/Soleone/tasks/commit/d8e9b4b771d9758e66cdd53ea25d60e5f52859d2))
* **sync:** show tasks changed on two devices and keep one version ([70cee04](https://github.com/Soleone/tasks/commit/70cee048879d275616091f6eaa17cce24a24005e))
* **theme:** star favorite palettes and filter the theme picker ([751bbb4](https://github.com/Soleone/tasks/commit/751bbb4ad6dee7fafb69b41c58c233ec67f1316c))

### Bug Fixes

* **search:** match letters outside ASCII whatever their case, so übung finds Übung ([1f49b32](https://github.com/Soleone/tasks/commit/1f49b3236fd8368e545d9b4feae009b7d0966b76))
* **sync:** on Windows, a task arriving from another device no longer makes the folder look broken for a moment ([461b74c](https://github.com/Soleone/tasks/commit/461b74c270ff41f8ee07cb89dafc14f6ddb3fa90))

### Performance Improvements

* **backend:** the app asks the system which task files changed instead of checking every one, so views, search and the background check stay fast at any folder size ([ec016d0](https://github.com/Soleone/tasks/commit/ec016d0ebc0bbb5a05cdbdccc0720925a76becc2))
* **backend:** the list refreshes several times faster right after a change, and no longer depends on the system reporting file changes ([bbfdb9f](https://github.com/Soleone/tasks/commit/bbfdb9f9d39a18c95120a8d4f93df01621512083))
* **cli:** a tasks-cli command reads only the task files that changed since the last one, so it answers up to four times faster in large folders ([6e6328e](https://github.com/Soleone/tasks/commit/6e6328e747614f310fd13719ebb104fb0335559f))
* **cli:** a tasks-cli command that changes a task reads only the files that changed since the last command, so it finishes sooner in large folders ([4222c9d](https://github.com/Soleone/tasks/commit/4222c9d8b8ea473d69e9cc1855d5b00837dde8a4))
* **list:** a refresh reads the task folder twice instead of four or five times, so the list and header counts update about twice as fast on Windows ([cc1783a](https://github.com/Soleone/tasks/commit/cc1783a889d47f228ff3ce5463cb12dd7efc17a0))

## [0.5.3](https://github.com/Soleone/tasks/compare/v0.5.2...v0.5.3) (2026-11-10)

### Features

* **done-lens:** shift-click the count line in the done lens to step back to the previous window ([3779588](https://github.com/Soleone/tasks/commit/37795883011dc8b38081d837d95ad1dedd550def))
* **done-lens:** show the time of day instead of the weekday on rows in the today and yesterday done lens ([a305d16](https://github.com/Soleone/tasks/commit/a305d167757a13c963084e5dacad7feb8b5372a8))
* **settings:** a cleaner Goals section, with folder icons, the numbers lined up on the right and section icons for Goals and Category colors ([cb4a06e](https://github.com/Soleone/tasks/commit/cb4a06e6fd87616cf4c2d6f8ec30077b18ccda8c))
* **settings:** every settings section has an icon next to its title ([feffe2f](https://github.com/Soleone/tasks/commit/feffe2fa5e7dbe215fd26e10d07251dd108a593c))
* **touch:** swipe left to go back, like Escape ([54ba57d](https://github.com/Soleone/tasks/commit/54ba57d1ae6bb39c304d5803d0a86218694f45b9))

### Bug Fixes

* **editor:** the caret lands after the text when Tab moves between title and description ([001e843](https://github.com/Soleone/tasks/commit/001e843fdd0558eef3294b0de9010f4ebbbce23e))
* **web:** support themes in the hosted backend ([32e287c](https://github.com/Soleone/tasks/commit/32e287c798e83cbdd030132fc5c4ec3ecc4f4c83))

## [0.5.2](https://github.com/Soleone/tasks/compare/v0.5.1...v0.5.2) (2026-11-09)

### Features

* **themes:** drop your own themes into the Tasks home's themes folder and pick them in the theme picker ([df96a1d](https://github.com/Soleone/tasks/commit/df96a1d105aff91da4feca962b32699d0d25f2ca))

## [0.5.1](https://github.com/Soleone/tasks/compare/v0.5.0...v0.5.1) (2026-11-09)

### Features

* **branding:** new app icon with a gilt gold checkmark on a dark tile ([f90566c](https://github.com/Soleone/tasks/commit/f90566c5e16981c63d8b5e8a02b0a97a84909e4d))
* **goals:** goal rings take their time flying from the header into the done lens's pills, one after another ([200ed30](https://github.com/Soleone/tasks/commit/200ed305133a75f0082eed1e32fcda8398d40594))
* **goals:** meeting every goal folds the met check into the done count with a sheen and sparks ([1488978](https://github.com/Soleone/tasks/commit/1488978329a6bdcdd63fcfcb59cdc6ab49c879de))
* **goals:** opening the done lens brings each goal ring down from the header into its pill ([121de7d](https://github.com/Soleone/tasks/commit/121de7df18134bc13fc8cc7e8fc7a206195da891))
* **goals:** the done count and its goal rings fly in together and land at the same moment ([2bbb371](https://github.com/Soleone/tasks/commit/2bbb37156eeae35b85ed612f760454b74309b12c))
* **lenses:** a lens's count and goal rings fly twice as fast, so turning a lens on feels snappy ([d593259](https://github.com/Soleone/tasks/commit/d593259ce474bb690115708a1709124be20a9d36))
* **lens:** the done lens shows yesterday between today and the last 7 days ([314947c](https://github.com/Soleone/tasks/commit/314947c7405399f9204d1b0f30f1c26280fada98))
* **settings:** remove a category goal with its × instead of clearing the number ([6f77b65](https://github.com/Soleone/tasks/commit/6f77b6529627378522fc91403fb8320c3cfcec6e))

### Bug Fixes

* **filters:** the category filter shows the category's own color, styled like a task row's category ([97d2357](https://github.com/Soleone/tasks/commit/97d235774a396b156b7f4859c63527046fdedf29))
* **filters:** the filter summary uses one quiet size, with the category lined up beside the task count ([83c1893](https://github.com/Soleone/tasks/commit/83c189382c877a734d044a313f9a2d4d591ab0b9))
* **goals:** hovering a weekly goal in the done lens shows this week's progress, not the day's total ([14663ec](https://github.com/Soleone/tasks/commit/14663ec68806764586dfd81913fafc1307a6e44f))
* **goals:** the goal rings keep a gap from the done count, so its pressed border no longer touches them ([086992d](https://github.com/Soleone/tasks/commit/086992dcee8febd2f789ae68f91c90944b407323))
* **lens:** tasks no longer vanish while the list turns into or out of a lens ([268c1fd](https://github.com/Soleone/tasks/commit/268c1fdd6b1e25595c33f1fc013c964be48356c2))
* **lens:** the due count in the header is red, so it stands apart from the accent in every theme ([7c18496](https://github.com/Soleone/tasks/commit/7c1849626d02c110afe111d171f4e674f0e7e67f))
* **rows:** due dates for today and late tasks are red, matching the due count ([24d3114](https://github.com/Soleone/tasks/commit/24d3114852ec99b8d958230a402a07d596110665))
* **settings:** goals fit a phone screen, with a day / a week on their own line ([7f4b642](https://github.com/Soleone/tasks/commit/7f4b64270b6ae2dfc9087bd0701ee616f5eac73b))
* **settings:** the settings dialog fits a phone screen without scrolling sideways ([f7f95b2](https://github.com/Soleone/tasks/commit/f7f95b226c1382778b839a23fe7e2afd170df072))
* **toolbar:** filters in the count line show their tooltip right away instead of a slow browser hint ([7a83152](https://github.com/Soleone/tasks/commit/7a831525d84020cb87988d8a70170b14a80edeca))
* **tooltips:** hover hints on rows, pills, images and goals show at once in the app's own style ([35b6495](https://github.com/Soleone/tasks/commit/35b6495a7b370442620942e305fd4a24fb44599d))
* **tooltips:** the search in the count line says Clear search without repeating the query ([8f3b9ee](https://github.com/Soleone/tasks/commit/8f3b9ee7b68ce94b4f4070106a088c48fb6f195d))
* **tooltips:** tooltips close when you switch tabs or apps, or move off their control ([dfe1c67](https://github.com/Soleone/tasks/commit/dfe1c6704c812e067c335f45e7cdf5e2e24cddc5))
* **tooltips:** tooltips skip what's already on screen, like a goal pill's name and today's numbers ([067ec1b](https://github.com/Soleone/tasks/commit/067ec1be9d7cabdf9acdd3cb13e8cdce141a1eab))

## [0.5.0](https://github.com/Soleone/tasks/compare/v0.4.4...v0.5.0) (2026-11-08)

### Features

* **goals:** let the day end as late as 11:00, for nights that run into the morning ([e2f606c](https://github.com/Soleone/tasks/commit/e2f606c480c2ae95346840c39e388938214d5c3c))
* **goals:** read goal numbers as 1/2 with the goal dimmed, and keep the met green legible in tooltips ([7411a1b](https://github.com/Soleone/tasks/commit/7411a1bbd89cd1570b1b5cd285d739f7f0df5e41))
* **goals:** set daily or weekly goals per category and log tasks already done ([bad2655](https://github.com/Soleone/tasks/commit/bad2655dbb3a3873acb01463a06cc1bd7fc2e545))
* **goals:** show category goal rings on phones, as many as fit ([f8585fe](https://github.com/Soleone/tasks/commit/f8585feb73bebd04da05dfacfd0852d283d3ee60))
* **goals:** show goal numbers as 1 / 2 ([ae952af](https://github.com/Soleone/tasks/commit/ae952afb869a7ce2663e5f884b8be390530d630f))
* **learning:** a Day by day quest teaches goals and logging what you already did ([76038c4](https://github.com/Soleone/tasks/commit/76038c4bc6f4b616d8e00597636c84cb0c3f4f11))
* **learning:** move the Day by day quest to the end, before Make it yours ([cb182d1](https://github.com/Soleone/tasks/commit/cb182d17e7ccff76cda7bd5e0c834922bbedf6ea))
* **settings:** give categories a color in Settings › Categories ([9638890](https://github.com/Soleone/tasks/commit/96388904bf6107b2d75097b97cb4a677b37408c2))
* **settings:** list categories most recently used first, as the category picker does ([3db9d01](https://github.com/Soleone/tasks/commit/3db9d018fd8b9093a3fd0b1c6a89e9c164f84aa0))
* **settings:** type a category's name to jump to it in Settings › Categories ([8142f2d](https://github.com/Soleone/tasks/commit/8142f2d337c914d4c8a1678e576f8c730f689dde))

### Bug Fixes

* **goals:** ease each ring's fill as the check lands, and drop the pip for everything else ([97362b6](https://github.com/Soleone/tasks/commit/97362b62220534618a46d37e3fe443fdabf71c48))
* **goals:** fill the done count's ring only once every goal is met ([2cb6dff](https://github.com/Soleone/tasks/commit/2cb6dff08c471bf0523c088a96ed9f9aaf7c0efe))
* **goals:** keep everything else out of the header's small rings ([7604ed4](https://github.com/Soleone/tasks/commit/7604ed442be3b279722bda4f0fc9af66f3bdc937))
* **goals:** let rings fill smoothly without the done count's bump ([20ba4c5](https://github.com/Soleone/tasks/commit/20ba4c50439fcae9a3e21c0671ecb180944cacba))
* **goals:** make the empty part of a goal ring easier to see ([9e9ae5f](https://github.com/Soleone/tasks/commit/9e9ae5f3ed46d826d9f017fd8678d076f9ea5f99))
* **settings:** Down from a tab enters its section, and stray arrows move nothing ([5ad7656](https://github.com/Soleone/tasks/commit/5ad76561a6e0a6091efd55321b73f320597ec2bb))

### Performance Improvements

* **list:** keep arrow keys and scrolling responsive in long lists ([5befc00](https://github.com/Soleone/tasks/commit/5befc006ceef1e191bf5acede29ca7569792cd78))

## [0.4.4](https://github.com/Soleone/tasks/compare/v0.4.3...v0.4.4) (2026-11-06)

### Features

* **cli:** rename a category or tag on every task with tasks-cli category rename and tag rename, merging into a name already in use ([0f8a465](https://github.com/Soleone/tasks/commit/0f8a46518f1576d483726d1d7801e23f2db67a60))
* **pickers:** rename a category or tag on every task ([879254b](https://github.com/Soleone/tasks/commit/879254b18a67e6fa8895765e4e865bc67f259572))

### Bug Fixes

* **toolbar:** show lens statuses in the status chip ([6a376ca](https://github.com/Soleone/tasks/commit/6a376cac1373c8291e9f8ff156830a7948c3dbe8))

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
