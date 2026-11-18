<template>
  <AppShell>
    <div class="kg-page-head">
      <div>
        <h1>
          {{ $t('apps.applications_title') }}
          <span v-if="apps.length" class="kg-count-chip">{{ appCountLabel }}</span>
        </h1>
        <p class="kg-sub">{{ $t('apps.applications_desc') }}</p>
      </div>
      <div class="kg-page-actions">
        <button class="kg-btn kg-btn-primary" type="button" @click="newApp">
          <LayersPlus :size="16" class="kg-icon" aria-hidden="true"></LayersPlus>
          {{ $t('apps.add_new') }}
        </button>
      </div>
    </div>

    <div class="kg-between kg-row-wrap" v-if="apps && apps.length > 0">
      <div class="kg-search-field" style="min-width: 240px; flex: 1">
        <Search :size="15" aria-hidden="true"></Search>
        <label for="app-search" class="kg-visually-hidden">{{ $t('apps.search_placeholder') }}</label>
        <input
          id="app-search"
          ref="searchInput"
          v-model="searchQuery"
          class="kg-input"
          type="search"
          :placeholder="$t('apps.search_placeholder')"
        />
      </div>
      <button
        class="kg-btn kg-btn-secondary kg-btn-sm"
        type="button"
        :aria-pressed="sortMode !== 'default'"
        :title="`${$t('apps.sort_by_name')}: ${sortModeLabel}`"
        @click="toggleSort"
      >
        <ArrowUpDown v-if="sortMode === 'default'" :size="14" class="kg-icon" aria-hidden="true"></ArrowUpDown>
        <ArrowUp v-else-if="sortMode === 'asc'" :size="14" class="kg-icon" aria-hidden="true"></ArrowUp>
        <ArrowDown v-else :size="14" class="kg-icon" aria-hidden="true"></ArrowDown>
        {{ $t('apps.sort_by_name') }}
      </button>
    </div>

    <div class="kg-grid" style="grid-template-columns: minmax(0, 1fr) 320px" v-if="displayedApps.length > 0">
      <div class="kg-app-grid">
        <article
          v-for="{ app, index } in displayedApps"
          :key="index"
          class="kg-card kg-app-card kg-card-interactive"
          :aria-current="selectedIndex === index ? 'true' : undefined"
          @click="selectApp(index)"
        >
          <div class="kg-app-poster">
            <img
              v-if="app['image-path']"
              :src="'/api/covers/' + index"
              :alt="app.name"
              @error="handleImageError"
            />
            <div v-else class="kg-app-poster-placeholder">
              <span>{{ initialFor(app) }}</span>
            </div>
          </div>
          <div class="kg-app-body">
            <h2 class="kg-app-name kg-truncate">{{ app.name }}</h2>
            <div class="kg-app-flags">
              <span v-if="app.elevated" class="kg-badge kg-badge-warning">{{ $t('apps.badge_admin') }}</span>
              <span v-if="app.detached && app.detached.length" class="kg-badge kg-badge-neutral">{{ $t('apps.badge_detached') }}</span>
              <span v-if="app['prep-cmd'] && app['prep-cmd'].length" class="kg-badge kg-badge-accent">{{ $t('apps.badge_app_prep') }}</span>
              <span v-if="app['exclude-global-prep-cmd']" class="kg-badge kg-badge-neutral">{{ $t('apps.badge_no_global_prep') }}</span>
              <span v-if="app['auto-detach']" class="kg-badge kg-badge-neutral">{{ $t('apps.badge_auto_detach') }}</span>
            </div>
            <div class="kg-app-actions">
              <button class="kg-btn kg-btn-primary kg-btn-sm" type="button" @click.stop="editApp(index)">
                <Edit :size="14" class="kg-icon" aria-hidden="true"></Edit>
                {{ $t('apps.edit') }}
              </button>
              <button
                class="kg-btn kg-btn-danger kg-btn-sm"
                type="button"
                :aria-label="$t('apps.delete')"
                :title="$t('apps.delete')"
                @click.stop="showDeleteModal(index)"
              >
                <Trash2 :size="14" class="kg-icon" aria-hidden="true"></Trash2>
              </button>
            </div>
          </div>
        </article>
      </div>

      <!-- Inspetor -->
      <aside class="kg-card" aria-labelledby="app-inspector-title">
        <div class="kg-card-head">
          <h2 id="app-inspector-title">{{ $t('apps.details') }}</h2>
        </div>
        <div v-if="selectedApp" class="kg-card-pad kg-stack-3">
          <div>
            <p class="kg-label">{{ $t('apps.app_name') }}</p>
            <p class="kg-app-name">{{ selectedApp.name }}</p>
          </div>
          <div v-if="selectedApp.cmd">
            <p class="kg-label">{{ $t('apps.cmd') }}</p>
            <p class="kg-mono kg-truncate" :title="selectedApp.cmd">{{ selectedApp.cmd }}</p>
          </div>
          <div v-if="selectedApp['working-dir']">
            <p class="kg-label">{{ $t('apps.working_dir') }}</p>
            <p class="kg-mono kg-truncate" :title="selectedApp['working-dir']">{{ selectedApp['working-dir'] }}</p>
          </div>
          <div v-if="selectedApp.output">
            <p class="kg-label">{{ $t('apps.output_short') }}</p>
            <p class="kg-mono kg-truncate" :title="selectedApp.output">{{ selectedApp.output }}</p>
          </div>
          <dl class="kg-stat-grid">
            <div class="kg-stat-tile">
              <dt>{{ $t('apps.cmd_prep_name') }}</dt>
              <dd>{{ (selectedApp['prep-cmd'] || []).length }} {{ $t('apps.prep_count') }}</dd>
            </div>
            <div class="kg-stat-tile">
              <dt>{{ $t('apps.detached_cmds') }}</dt>
              <dd>{{ (selectedApp.detached || []).length }} {{ $t('apps.detached_count') }}</dd>
            </div>
            <div class="kg-stat-tile">
              <dt>{{ $t('apps.exit_timeout_short') }}</dt>
              <dd>{{ selectedApp['exit-timeout'] ?? 0 }}</dd>
            </div>
          </dl>
          <button class="kg-btn kg-btn-secondary kg-btn-block" type="button" @click="editApp(selectedIndex)">
            <Edit :size="15" class="kg-icon" aria-hidden="true"></Edit>
            {{ $t('apps.open_editor') }}
          </button>
        </div>
        <div v-else class="kg-empty">
          <span>{{ $t('apps.inspector_empty') }}</span>
        </div>
      </aside>
    </div>

    <div v-else-if="apps && apps.length > 0" class="kg-card">
      <div class="kg-empty">
        <Search :size="24" aria-hidden="true"></Search>
        <span>{{ $t('apps.no_search_results') }}</span>
      </div>
    </div>

    <div v-else-if="loadError" class="kg-card">
      <div class="kg-empty kg-text-danger" role="alert">
        <span>{{ loadError }}</span>
        <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" @click="loadApps">
          {{ $t('troubleshooting.permissions_refresh') }}
        </button>
      </div>
    </div>

    <div v-else class="kg-card">
      <div class="kg-empty">
        <LayersPlus :size="24" aria-hidden="true"></LayersPlus>
        <span>{{ $t('apps.no_applications') }}</span>
      </div>
    </div>

    <!-- Editor -->
    <KgModal
      :open="editModalOpen"
      :title="editModalTitle"
      title-id="appEditModalLabel"
      size="lg"
      :close-label="$t('_common.close')"
      @close="closeEditModal"
    >
      <div v-if="editForm" class="kg-stack-3">
        <div v-if="editFormError" class="kg-callout kg-callout-danger" role="alert">{{ editFormError }}</div>

        <div class="kg-field">
          <label for="appName" class="kg-label">{{ $t('apps.app_name') }}</label>
          <input id="appName" v-model="editForm.name" class="kg-input" type="text" aria-describedby="appNameHelp" />
          <p id="appNameHelp" class="kg-help">{{ $t('apps.app_name_desc') }}</p>
        </div>

        <div class="kg-field">
          <label for="appOutput" class="kg-label">{{ $t('apps.output_name') }}</label>
          <div class="kg-input-group">
            <input id="appOutput" v-model="editForm.output" class="kg-input kg-mono" type="text" aria-describedby="appOutputHelp" />
            <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" :aria-label="$t('_common.browse')" @click="browseFor('any', 'file_browser.select_file', editForm.output, v => editForm.output = v)">
              <FolderOpen :size="15" class="kg-icon" aria-hidden="true"></FolderOpen>
            </button>
          </div>
          <p id="appOutputHelp" class="kg-help">{{ $t('apps.output_desc') }}</p>
        </div>

        <Checkbox
          id="excludeGlobalPrep"
          label="apps.global_prep_name"
          desc="apps.global_prep_desc"
          v-model="editForm['exclude-global-prep-cmd']"
          default="true"
          inverse-values
        />

        <div class="kg-field">
          <span class="kg-label">{{ $t('apps.cmd_prep_name') }}</span>
          <p class="kg-help">{{ $t('apps.cmd_prep_desc') }}</p>
          <button v-if="editForm['prep-cmd'].length === 0" class="kg-btn kg-btn-success kg-btn-sm kg-mt-2" type="button" @click="addPrepCmd">
            <Plus :size="14" class="kg-icon" aria-hidden="true"></Plus>
            {{ $t('apps.add_cmds') }}
          </button>
          <div v-if="editForm['prep-cmd'].length > 0" class="kg-table-wrap kg-mt-2">
            <table class="kg-table">
              <thead>
                <tr>
                  <th scope="col">{{ $t('_common.do_cmd') }}</th>
                  <th scope="col">{{ $t('_common.undo_cmd') }}</th>
                  <th v-if="platform === 'windows'" scope="col">{{ $t('_common.run_as') }}</th>
                  <th scope="col"><span class="kg-visually-hidden">{{ $t('apps.actions') }}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(command, index) in editForm['prep-cmd']" :key="index">
                  <td>
                    <div class="kg-input-group">
                      <label :for="`prep-cmd-do-${index}`" class="kg-visually-hidden">{{ $t('_common.do_cmd') }}</label>
                      <input :id="`prep-cmd-do-${index}`" v-model="command.do" class="kg-input kg-mono" type="text" />
                      <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" @click="browsePrep(index, 'do')">
                        <FolderOpen :size="14" class="kg-icon" aria-hidden="true"></FolderOpen>
                      </button>
                    </div>
                  </td>
                  <td>
                    <div class="kg-input-group">
                      <label :for="`prep-cmd-undo-${index}`" class="kg-visually-hidden">{{ $t('_common.undo_cmd') }}</label>
                      <input :id="`prep-cmd-undo-${index}`" v-model="command.undo" class="kg-input kg-mono" type="text" />
                      <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" @click="browsePrep(index, 'undo')">
                        <FolderOpen :size="14" class="kg-icon" aria-hidden="true"></FolderOpen>
                      </button>
                    </div>
                  </td>
                  <td v-if="platform === 'windows'">
                    <Checkbox :id="'prep-cmd-admin-' + index" label="_common.elevated" desc="" v-model="command.elevated" />
                  </td>
                  <td>
                    <div class="kg-row">
                      <button class="kg-btn kg-btn-danger kg-btn-sm" type="button" :aria-label="$t('apps.delete')" @click="deletePrepCmd(index)">
                        <Trash2 :size="14" class="kg-icon" aria-hidden="true"></Trash2>
                      </button>
                      <button class="kg-btn kg-btn-success kg-btn-sm" type="button" :aria-label="$t('apps.add_cmds')" @click="addPrepCmd">
                        <Plus :size="14" class="kg-icon" aria-hidden="true"></Plus>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="kg-field">
          <span class="kg-label">{{ $t('apps.detached_cmds') }}</span>
          <div v-for="(command, index) in editForm.detached" :key="index" class="kg-row kg-mt-2">
            <label :for="`detached-command-${index}`" class="kg-visually-hidden">{{ $t('apps.detached_cmds') }}</label>
            <input :id="`detached-command-${index}`" v-model="editForm.detached[index]" class="kg-input kg-mono" type="text" />
            <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" :aria-label="$t('_common.browse')" @click="browseDetached(index)">
              <FolderOpen :size="14" class="kg-icon" aria-hidden="true"></FolderOpen>
            </button>
            <button class="kg-btn kg-btn-danger kg-btn-sm" type="button" :aria-label="$t('apps.delete')" @click="editForm.detached.splice(index, 1)">
              <Trash2 :size="14" class="kg-icon" aria-hidden="true"></Trash2>
            </button>
            <button class="kg-btn kg-btn-success kg-btn-sm" type="button" :aria-label="$t('apps.detached_cmds_add')" @click="addDetached">
              <Plus :size="14" class="kg-icon" aria-hidden="true"></Plus>
            </button>
          </div>
          <button v-if="editForm.detached.length === 0" class="kg-btn kg-btn-success kg-btn-sm kg-mt-2" type="button" @click="addDetached">
            <Plus :size="14" class="kg-icon" aria-hidden="true"></Plus>
            {{ $t('apps.detached_cmds_add') }}
          </button>
          <p class="kg-help">
            {{ $t('apps.detached_cmds_desc') }}<br />
            <strong>{{ $t('_common.note') }}</strong> {{ $t('apps.detached_cmds_note') }}
          </p>
        </div>

        <div class="kg-field">
          <label for="appCmd" class="kg-label">{{ $t('apps.cmd') }}</label>
          <div class="kg-input-group">
            <input id="appCmd" v-model="editForm.cmd" class="kg-input kg-mono" type="text" aria-describedby="appCmdHelp" />
            <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" :aria-label="$t('_common.browse')" @click="browseFor('executable', 'file_browser.select_executable', editForm.cmd, v => editForm.cmd = v)">
              <FolderOpen :size="15" class="kg-icon" aria-hidden="true"></FolderOpen>
            </button>
          </div>
          <p id="appCmdHelp" class="kg-help">
            {{ $t('apps.cmd_desc') }}<br />
            <strong>{{ $t('_common.note') }}</strong> {{ $t('apps.cmd_note') }}
          </p>
        </div>

        <div class="kg-field">
          <label for="appWorkingDir" class="kg-label">{{ $t('apps.working_dir') }}</label>
          <div class="kg-input-group">
            <input id="appWorkingDir" v-model="editForm['working-dir']" class="kg-input kg-mono" type="text" aria-describedby="appWorkingDirHelp" />
            <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" :aria-label="$t('_common.browse')" @click="browseFor('directory', 'file_browser.select_directory', editForm['working-dir'], v => editForm['working-dir'] = v)">
              <FolderOpen :size="15" class="kg-icon" aria-hidden="true"></FolderOpen>
            </button>
          </div>
          <p id="appWorkingDirHelp" class="kg-help">{{ $t('apps.working_dir_desc') }}</p>
        </div>

        <Checkbox
          v-if="platform === 'windows'"
          id="appElevation"
          label="_common.run_as"
          desc="apps.run_as_desc"
          v-model="editForm.elevated"
          default="false"
        />
        <Checkbox id="autoDetach" label="apps.auto_detach" desc="apps.auto_detach_desc" v-model="editForm['auto-detach']" default="true" />
        <Checkbox id="waitAll" label="apps.wait_all" desc="apps.wait_all_desc" v-model="editForm['wait-all']" default="true" />

        <div class="kg-field">
          <label for="exitTimeout" class="kg-label">{{ $t('apps.exit_timeout') }}</label>
          <input id="exitTimeout" v-model="editForm['exit-timeout']" class="kg-input kg-mono" type="number" min="0" placeholder="5" aria-describedby="exitTimeoutHelp" />
          <p id="exitTimeoutHelp" class="kg-help">{{ $t('apps.exit_timeout_desc') }}</p>
        </div>

        <div class="kg-field">
          <label for="appImagePath" class="kg-label">{{ $t('apps.image') }}</label>
          <div class="kg-input-group">
            <input id="appImagePath" v-model="editForm['image-path']" class="kg-input kg-mono" type="text" aria-describedby="appImagePathHelp" />
            <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" :aria-label="$t('_common.browse')" @click="browseFor('file', 'file_browser.select_file', editForm['image-path'], v => editForm['image-path'] = v, ['.png'])">
              <FolderOpen :size="15" class="kg-icon" aria-hidden="true"></FolderOpen>
            </button>
            <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" @click="showCoverFinder">
              <Search :size="14" class="kg-icon" aria-hidden="true"></Search>
              {{ $t('apps.find_cover') }}
            </button>
          </div>
          <p id="appImagePathHelp" class="kg-help">{{ $t('apps.image_desc') }}</p>
        </div>

        <div class="kg-callout kg-callout-info kg-stack-3">
          <div>
            <h4>{{ $t('apps.env_vars_about') }}</h4>
            <p class="kg-mt-2">{{ $t('apps.env_vars_desc') }}</p>
          </div>
          <div class="kg-table-wrap">
            <table class="kg-table">
              <thead>
                <tr>
                  <th scope="col">{{ $t('apps.env_var_name') }}</th>
                  <th scope="col">{{ $t('apps.env_var_description') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="variable in environmentVariables" :key="variable.name">
                  <td class="kg-mono">{{ variable.name }}</td>
                  <td>{{ $t(variable.descriptionKey) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="platform === 'windows'">
            <strong>{{ $t('apps.env_qres_example') }}</strong>
            <pre>cmd /C &lt;{{ $t('apps.env_qres_path') }}&gt;\QRes.exe /X:%KLOUD_GAMES_CLIENT_WIDTH% /Y:%KLOUD_GAMES_CLIENT_HEIGHT% /R:%KLOUD_GAMES_CLIENT_FPS%</pre>
          </div>
          <div v-else-if="platform === 'freebsd' || platform === 'linux'">
            <strong>{{ $t('apps.env_xrandr_example') }}</strong>
            <pre>sh -c "xrandr --output HDMI-1 --mode \"${KLOUD_GAMES_CLIENT_WIDTH}x${KLOUD_GAMES_CLIENT_HEIGHT}\" --rate ${KLOUD_GAMES_CLIENT_FPS}"</pre>
          </div>
          <div v-else-if="platform === 'macos'">
            <strong>{{ $t('apps.env_displayplacer_example') }}</strong>
            <pre>sh -c "displayplacer "id:&lt;screenId&gt; res:${KLOUD_GAMES_CLIENT_WIDTH}x${KLOUD_GAMES_CLIENT_HEIGHT} hz:${KLOUD_GAMES_CLIENT_FPS} scaling:on origin:(0,0) degree:0""</pre>
          </div>
          <a :href="`${documentationBaseUrl}/md_docs_2app__examples.html`" target="_blank" rel="noopener noreferrer">{{ $t('_common.see_more') }}</a>
        </div>
        <div ref="editModalBody" class="kg-visually-hidden" aria-hidden="true"></div>
      </div>

      <template #footer>
        <button class="kg-btn kg-btn-secondary" type="button" @click="closeEditModal">
          <X :size="16" class="kg-icon" aria-hidden="true"></X>
          {{ $t('_common.cancel') }}
        </button>
        <button class="kg-btn kg-btn-primary" type="button" @click="save">
          <Save :size="16" class="kg-icon" aria-hidden="true"></Save>
          {{ $t('_common.save') }}
        </button>
      </template>
    </KgModal>

    <!-- Cover finder -->
    <KgModal
      :open="coverFinderOpen"
      :title="coverFinderTitle"
      title-id="coverFinderModalLabel"
      size="lg"
      :close-label="$t('_common.close')"
      @close="closeCoverFinder"
    >
      <div class="kg-stack-3">
        <div class="kg-input-group">
          <label for="cover-search-query" class="kg-visually-hidden">{{ $t('_common.search') }}</label>
          <input
            id="cover-search-query"
            v-model="coverSearchQuery"
            class="kg-input"
            type="text"
            :placeholder="editForm?.name"
            @keyup.enter="performCoverSearch"
          />
          <button class="kg-btn kg-btn-primary kg-btn-sm" type="button" @click="performCoverSearch">
            <Search :size="15" class="kg-icon" aria-hidden="true"></Search>
            {{ $t('_common.search') }}
          </button>
        </div>
        <p class="kg-help">
          <strong>{{ $t('_common.note') }}</strong> {{ $t('apps.cover_search_hint') }}
          <a href="https://www.igdb.com/" target="_blank" rel="noopener noreferrer">IGDB</a>
        </p>
        <div v-if="coverSearching" class="kg-empty">
          <span class="kg-spinner" aria-hidden="true"></span>
          <span>{{ $t('apps.loading') }}</span>
        </div>
        <div v-else class="kg-cover-grid">
          <button
            v-for="cover in coverCandidates"
            :key="cover.url"
            type="button"
            class="kg-cover-choice"
            :disabled="coverFinderBusy"
            @click="useCover(cover)"
          >
            <img :src="cover.url" :alt="cover.name" />
            <span class="kg-cover-name kg-truncate">{{ cover.name }}</span>
          </button>
        </div>
      </div>
      <template #footer>
        <button class="kg-btn kg-btn-secondary" type="button" @click="closeCoverFinder">
          <X :size="16" class="kg-icon" aria-hidden="true"></X>
          {{ $t('_common.cancel') }}
        </button>
      </template>
    </KgModal>

    <!-- File browser -->
    <KgModal
      :open="fileBrowserOpen"
      :title="fileBrowserTitle || $t('file_browser.title')"
      title-id="fileBrowserTitle"
      size="lg"
      :close-label="$t('_common.close')"
      @close="fileBrowserClose"
    >
      <div class="kg-stack-3">
        <div class="kg-input-group">
          <label for="file-browser-path" class="kg-visually-hidden">{{ $t('file_browser.title') }}</label>
          <input
            id="file-browser-path"
            v-model="fileBrowserTypedPath"
            class="kg-input kg-mono"
            type="text"
            @input="fileBrowserOnTypedInput"
            @keyup.enter="fileBrowserNavigate(fileBrowserTypedPath)"
          />
          <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" :aria-label="$t('file_browser.up')" @click="fileBrowserNavigate(fileBrowserTypedPath)">
            <ArrowRight :size="15" class="kg-icon" aria-hidden="true"></ArrowRight>
          </button>
        </div>
        <div>
          <button
            class="kg-btn kg-btn-secondary kg-btn-sm"
            type="button"
            :disabled="fileBrowserLoading || fileBrowserParentPath === fileBrowserCurrentPath"
            @click="fileBrowserNavigateUp"
          >
            <FolderUp :size="14" class="kg-icon" aria-hidden="true"></FolderUp>
            {{ $t('file_browser.up') }}
          </button>
        </div>
        <div v-if="fileBrowserError" class="kg-callout kg-callout-danger" role="alert">{{ fileBrowserError }}</div>
        <div v-if="fileBrowserLoading" class="kg-empty">
          <span class="kg-spinner kg-spinner-sm" aria-hidden="true"></span>
          <span>{{ $t('_common.loading') }}</span>
        </div>
        <div v-else class="kg-file-list">
          <p v-if="fileBrowserEntries.length === 0" class="kg-empty">{{ $t('file_browser.empty') }}</p>
          <button
            v-for="entry in fileBrowserEntries"
            :key="entry.path"
            type="button"
            class="kg-file-entry"
            :aria-selected="fileBrowserSelectedPath === entry.path ? 'true' : 'false'"
            @click="fileBrowserSelectEntry(entry)"
            @dblclick="fileBrowserActivateEntry(entry)"
          >
            <HardDrive v-if="!fileBrowserCurrentPath && entry.type === 'directory'" :size="15" class="kg-icon" aria-hidden="true"></HardDrive>
            <Folder v-else-if="entry.type === 'directory'" :size="15" class="kg-icon" aria-hidden="true"></Folder>
            <FileText v-else :size="15" class="kg-icon" aria-hidden="true"></FileText>
            <span class="kg-truncate">{{ entry.name }}</span>
          </button>
        </div>
      </div>
      <template #footer>
        <span v-if="fileBrowserSelectedPath" class="kg-grow kg-subtle kg-mono kg-truncate">{{ fileBrowserSelectedPath }}</span>
        <button class="kg-btn kg-btn-secondary" type="button" @click="fileBrowserClose">
          <X :size="16" class="kg-icon" aria-hidden="true"></X>
          {{ $t('_common.cancel') }}
        </button>
        <button class="kg-btn kg-btn-primary" type="button" :disabled="!fileBrowserSelectedPath && !fileBrowserTypedPath" @click="fileBrowserConfirm">
          <Check :size="16" class="kg-icon" aria-hidden="true"></Check>
          {{ $t('file_browser.select') }}
        </button>
      </template>
    </KgModal>

    <!-- Excluir -->
    <KgModal
      :open="deleteModalOpen"
      :title="$t('apps.delete_title')"
      title-id="appDeleteModalLabel"
      size="sm"
      :close-label="$t('_common.close')"
      @close="closeDeleteModal"
    >
      <div v-if="deleteTarget">
        <i18n-t keypath="apps.delete_confirm" tag="span">
          <template #name><strong>{{ deleteTarget.name }}</strong></template>
        </i18n-t>
      </div>
      <template #footer>
        <button class="kg-btn kg-btn-secondary" type="button" data-autofocus @click="closeDeleteModal">
          <X :size="16" class="kg-icon" aria-hidden="true"></X>
          {{ $t('_common.cancel') }}
        </button>
        <button class="kg-btn kg-btn-danger" type="button" @click="confirmDelete">
          <Trash2 :size="16" class="kg-icon" aria-hidden="true"></Trash2>
          {{ $t('apps.delete') }}
        </button>
      </template>
    </KgModal>
  </AppShell>
</template>

<script>
import { toRaw } from 'vue'
import AppShell from './components/AppShell.vue'
import Checkbox from './Checkbox.vue'
import KgModal from './components/ui/KgModal.vue'
import { publishHostMeta } from './components/host-meta'
import { apiFetch } from './fetch_utils'
import KLOUD_GAMESVersion from './KLOUD_GAMES_version'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Check,
  Edit,
  FileText,
  Folder,
  FolderOpen,
  FolderUp,
  HardDrive,
  LayersPlus,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from '@lucide/vue'

/**
 * @brief Return the GameDB bucket for an application name.
 *
 * @param {string} name Application name to categorize.
 * @returns {string} The normalized GameDB bucket name.
 */
function getSearchBucket(name) {
  const bucket = name.substring(0, Math.min(name.length, 2)).toLowerCase().replaceAll(/[^a-z\d]/g, '');
  return bucket || '@';
}

/**
 * @brief Search GameDB for cover candidates matching an application name.
 *
 * @param {string} name Application name to search for.
 * @returns {Promise<object[]>} Matching cover candidates.
 */
function searchCovers(name) {
  if (!name) {
    return Promise.resolve([]);
  }
  let searchName = name.replaceAll(/\s+/g, '.').toLowerCase();

  // Use raw.githubusercontent.com to avoid CORS issues as we migrate the CNAME
  let dbUrl = "https://raw.githubusercontent.com/LizardByte/GameDB/gh-pages";
  let bucket = getSearchBucket(name);
  return fetch(`${dbUrl}/buckets/${bucket}.json`).then(function (r) {
    if (!r.ok) throw new Error("Failed to search covers");
    return r.json();
  }).then(maps => Promise.all(Object.keys(maps).map(id => {
    let item = maps[id];
    if (item.name.replaceAll(/\s+/g, '.').toLowerCase().startsWith(searchName)) {
      return fetch(`${dbUrl}/games/${id}.json`).then(function (r) {
        return r.json();
      }).catch(() => null);
    }
    return null;
  }).filter(Boolean)))
    .then(results => results
      .filter(item => item && item.cover && item.cover.url)
      .map(game => {
        const thumb = game.cover.url;
        const dotIndex = thumb.lastIndexOf('.');
        const slashIndex = thumb.lastIndexOf('/');
        if (dotIndex < 0 || slashIndex < 0) {
          return null;
        }
        const slug = thumb.substring(slashIndex + 1, dotIndex);
        return {
          name: game.name,
          key: `igdb_${game.id}`,
          url: `https://images.igdb.com/igdb/image/upload/t_cover_big/${slug}.jpg`,
          saveUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${slug}.png`,
        }
      }).filter(Boolean));
}

/** Variaveis de ambiente documentadas na edicao de apps. */
const ENVIRONMENT_VARIABLES = [
  ['KLOUD_GAMES_APP_ID', 'apps.env_app_id'],
  ['KLOUD_GAMES_APP_NAME', 'apps.env_app_name'],
  ['KLOUD_GAMES_CLIENT_NAME', 'apps.env_client_name'],
  ['KLOUD_GAMES_CLIENT_WIDTH', 'apps.env_client_width'],
  ['KLOUD_GAMES_CLIENT_HEIGHT', 'apps.env_client_height'],
  ['KLOUD_GAMES_CLIENT_FPS', 'apps.env_client_fps'],
  ['KLOUD_GAMES_CLIENT_HDR', 'apps.env_client_hdr'],
  ['KLOUD_GAMES_CLIENT_GCMAP', 'apps.env_client_gcmap'],
  ['KLOUD_GAMES_CLIENT_HOST_AUDIO', 'apps.env_client_host_audio'],
  ['KLOUD_GAMES_CLIENT_ENABLE_SOPS', 'apps.env_client_enable_sops'],
  ['KLOUD_GAMES_CLIENT_AUDIO_CONFIGURATION', 'apps.env_client_audio_config'],
].map(([name, descriptionKey]) => ({ name, descriptionKey }))

export default {
  components: {
    AppShell,
    Checkbox,
    KgModal,
    ArrowDown,
    ArrowRight,
    ArrowUp,
    ArrowUpDown,
    Check,
    Edit,
    FileText,
    Folder,
    FolderOpen,
    FolderUp,
    HardDrive,
    LayersPlus,
    Plus,
    Save,
    Search,
    Trash2,
    X,
  },
  data() {
    return {
      apps: [],
      loadError: '',
      editForm: null,
      editFormError: "",
      coverSearching: false,
      coverFinderBusy: false,
      coverCandidates: [],
      coverSearchQuery: "",
      platform: "",
      fileBrowserType: "any",
      fileBrowserTitle: "",
      fileBrowserCallback: null,
      fileBrowserAcceptedExtensions: null,
      fileBrowserCurrentPath: "",
      fileBrowserParentPath: "",
      fileBrowserEntries: [],
      fileBrowserLoading: false,
      fileBrowserError: "",
      fileBrowserSelectedPath: "",
      fileBrowserTypedPath: "",
      searchQuery: "",
      sortMode: "default",
      deleteTarget: null,
      selectedIndex: -1,
      editModalOpen: false,
      coverFinderOpen: false,
      fileBrowserOpen: false,
      deleteModalOpen: false,
      version: null,
      githubVersion: null,
      environmentVariables: ENVIRONMENT_VARIABLES,
    };
  },
  computed: {
    installedVersionNotStable() {
      if (!this.githubVersion || !this.version) {
        return false;
      }
      return this.version.isGreater(this.githubVersion);
    },
    documentationBaseUrl() {
      const docsVersion = this.installedVersionNotStable ? 'master' : 'latest'
      return `https://docs.lizardbyte.dev/projects/KLOUD_GAMES/${docsVersion}`
    },
    displayedApps() {
      let list = this.apps.map((app, index) => ({ app, index }));

      const query = this.searchQuery.trim().toLowerCase();
      if (query) {
        list = list.filter(({ app }) =>
          (app.name || "").toLowerCase().includes(query)
        );
      }

      if (this.sortMode !== "default") {
        // Apps can be created without a name, so we compare name || ""
        list.sort((a, b) => {
          const result = (a.app.name || "").localeCompare(
            b.app.name || "", undefined, { sensitivity: "base" }
          );
          return this.sortMode === "asc"
            ? result
            : -result;
        });
      }

      return list;
    },
    sortModeLabel() {
      switch (this.sortMode) {
        case "asc":
          return this.$t("apps.sort_ascending");
        case "desc":
          return this.$t("apps.sort_descending");
        default:
          return this.$t("apps.sort_default");
      }
    },
    appCountLabel() {
      const total = this.apps.length;
      const shown = this.displayedApps.length;
      return shown === total
        ? `${total}`
        : `${shown} / ${total}`;
    },
    editModalTitle() {
      if (!this.editForm) {
        return "";
      }
      const action = this.editForm.index === -1
        ? this.$t("apps.add_new")
        : this.$t("apps.edit");

      return this.editForm.name
        ? `${action}: ${this.editForm.name}`
        : action;
    },
    selectedApp() {
      return this.selectedIndex >= 0 ? this.apps[this.selectedIndex] : null
    },
    coverFinderTitle() {
      if (this.coverSearching) return this.$t('apps.searching_covers')
      if (this.coverCandidates.length > 0) return `${this.$t('apps.covers_found')} (${this.coverCandidates.length})`
      return this.$t('apps.no_covers_found')
    },
  },
  created() {
    this.loadApps();

    fetch("./api/config")
      .then(r => r.json())
      .then(r => {
        this.platform = r.platform;
        this.version = new KLOUD_GAMESVersion(null, r.version);
        publishHostMeta(r)
      });

    fetch("https://api.github.com/repos/KLOUD_GAMESStream/KLOUD_GAMES/releases/latest")
      .then((r) => r.json())
      .then((r) => this.githubVersion = new KLOUD_GAMESVersion(r, null))
      .catch((e) => console.error(e));
  },
  mounted() {
    window.addEventListener('kg:focus-search', this.focusSearch)
  },
  beforeUnmount() {
    window.removeEventListener('kg:focus-search', this.focusSearch)
  },
  methods: {
    /** @return {void} Focus the page search input. */
    focusSearch() {
      this.$refs.searchInput?.focus()
    },
    /**
     * @brief Initial displayed in the poster placeholder.
     *
     * @param {object} app Application entry.
     * @return {string} Uppercase initial.
     */
    initialFor(app) {
      return (app.name || '?').charAt(0).toUpperCase()
    },
    /**
     * @brief Select an application for the inspector.
     *
     * @param {number} index Application index.
     * @return {void}
     */
    selectApp(index) {
      this.selectedIndex = index
    },
    newApp() {
      this.editForm = {
        name: "",
        output: "",
        cmd: "",
        index: -1,
        "exclude-global-prep-cmd": false,
        elevated: false,
        "auto-detach": true,
        "wait-all": true,
        "exit-timeout": 5,
        "prep-cmd": [],
        detached: [],
        "working-dir": "",
        "image-path": ""
      };
      this.editFormError = "";
      this.openEditModal();
    },
    /**
     * @brief Open an application for editing with nullish optional fields defaulted.
     * @param {number} id Index of the application to edit.
     */
    editApp(id) {
      this.editForm = structuredClone(toRaw(this.apps[id]));
      this.editForm.index = id;
      const defaults = {
        "prep-cmd": [],
        detached: [],
        "exclude-global-prep-cmd": false,
        elevated: false,
        "auto-detach": true,
        "wait-all": true,
        "exit-timeout": 5,
        cmd: "",
        output: "",
        "working-dir": "",
        "image-path": ""
      };
      for (const [key, value] of Object.entries(defaults)) {
        this.editForm[key] ??= value;
      }
      this.editFormError = "";
      this.openEditModal();
    },
    showDeleteModal(id) {
      this.deleteTarget = { index: id, name: this.apps[id].name };
      this.deleteModalOpen = true;
    },
    closeDeleteModal() {
      this.deleteModalOpen = false;
    },
    loadApps() {
      this.loadError = ''
      return fetch("./api/apps")
        .then((r) => r.json())
        .then((r) => {
          this.apps = r.apps || [];
        })
        .catch((error) => {
          this.loadError = error.message
        });
    },
    confirmDelete() {
      apiFetch("./api/apps/" + this.deleteTarget.index, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
      }).then((r) => {
        if (r.status === 200) document.location.reload();
      });
    },
    addPrepCmd() {
      let template = {
        do: "",
        undo: ""
      };

      if (this.platform === 'windows') {
        template = { ...template, elevated: false };
      }

      this.editForm["prep-cmd"].push(template);
    },
    deletePrepCmd(index) {
      this.editForm["prep-cmd"].splice(index, 1);
    },
    addDetached() {
      this.editForm.detached.push("");
    },
    showCoverFinder() {
      this.coverCandidates = [];
      this.coverSearchQuery = "";
      this.coverFinderOpen = true;
      this.performCoverSearch();
    },
    /** @brief Close the cover finder. @return {void} */
    closeCoverFinder() {
      this.coverFinderOpen = false;
    },
    performCoverSearch() {
      this.coverSearching = true;
      this.coverCandidates = [];

      // Use search query if provided, otherwise fall back to app name
      const searchTerm = this.coverSearchQuery.trim() || this.editForm["name"].toString();

      searchCovers(searchTerm)
        .then(list => this.coverCandidates = list)
        .finally(() => this.coverSearching = false);
    },
    useCover(cover) {
      this.coverFinderBusy = true;
      apiFetch("./api/covers/upload", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key: cover.key,
          url: cover.saveUrl,
        })
      }).then(r => {
        if (!r.ok) throw new Error("Failed to download covers");
        return r.json();
      }).then(body => {
        this.editForm["image-path"] = body.path;
        this.coverFinderOpen = false;
      })
        .finally(() => this.coverFinderBusy = false);
    },
    browseFor(type, titleKey, startPath, callback, acceptedExtensions = null) {
      this.fileBrowserType = type;
      this.fileBrowserTitle = this.$t(titleKey);
      this.fileBrowserCallback = callback;
      this.fileBrowserAcceptedExtensions = acceptedExtensions;
      this.fileBrowserSelectedPath = startPath || '';
      this.fileBrowserTypedPath = startPath || '';
      this.fileBrowserError = '';
      this.fileBrowserNavigate(startPath || '');
      this.fileBrowserOpen = true;
    },
    fileBrowserClose() {
      this.fileBrowserOpen = false;
    },
    fileBrowserConfirm() {
      const path = this.fileBrowserSelectedPath || this.fileBrowserTypedPath;
      if (path) {
        if (this.fileBrowserAcceptedExtensions && this.fileBrowserType !== 'directory') {
          const lowerPath = path.toLowerCase();
          const isValid = this.fileBrowserAcceptedExtensions.some(ext => lowerPath.endsWith(ext.toLowerCase()));
          if (!isValid) {
            this.fileBrowserError = this.$t('file_browser.error_invalid_extension', { extensions: this.fileBrowserAcceptedExtensions.join(', ') });
            return;
          }
        }
        if (this.fileBrowserCallback) {
          this.fileBrowserCallback(path);
          this.fileBrowserCallback = null;
        }
        this.fileBrowserClose();
      }
    },
    /**
     * @brief Load a directory listing and display any browsing failure.
     *
     * @param {string} path Directory path, or an empty string for the default location.
     * @return {Promise<void>} Completion of the directory request and loading-state update.
     */
    async fileBrowserNavigate(path) {
      this.fileBrowserLoading = true;
      this.fileBrowserError = '';
      const params = new URLSearchParams({ type: this.fileBrowserType });
      if (path) params.set('path', path);
      try {
        const response = await fetch(`./api/browse?${params.toString()}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Browse failed');
        }
        this.fileBrowserCurrentPath = data.path ?? '';
        this.fileBrowserParentPath = data.parent ?? '';
        this.fileBrowserEntries = data.entries ?? [];
        this.fileBrowserTypedPath = data.path ?? '';
        this.fileBrowserSelectedPath = this.fileBrowserType === 'directory' ? (data.path ?? '') : '';
      } catch (err) {
        this.fileBrowserError = err.message;
      } finally {
        this.fileBrowserLoading = false;
      }
    },
    fileBrowserNavigateUp() {
      this.fileBrowserNavigate(this.fileBrowserParentPath);
    },
    fileBrowserSelectEntry(entry) {
      if (entry.type === 'directory') {
        this.fileBrowserNavigate(entry.path);
      } else {
        this.fileBrowserSelectedPath = entry.path;
        this.fileBrowserTypedPath = entry.path;
      }
    },
    fileBrowserActivateEntry(entry) {
      if (entry.type === 'directory') {
        this.fileBrowserNavigate(entry.path);
      } else {
        this.fileBrowserSelectedPath = entry.path;
        this.fileBrowserTypedPath = entry.path;
        this.fileBrowserConfirm();
      }
    },
    fileBrowserOnTypedInput() {
      this.fileBrowserSelectedPath = this.fileBrowserTypedPath;
    },
    browsePrep(index, field) {
      const current = this.editForm['prep-cmd'][index][field] || '';
      this.browseFor('executable', 'file_browser.select_executable', current, (path) => {
        this.editForm['prep-cmd'][index][field] = path;
      });
    },
    browseDetached(index) {
      const current = this.editForm.detached[index] || '';
      this.browseFor('executable', 'file_browser.select_executable', current, (path) => {
        this.editForm.detached[index] = path;
      });
    },
    save() {
      this.editFormError = "";
      const currentImagePath = this.editForm["image-path"] == null ? "" : String(this.editForm["image-path"]).trim();
      this.editForm["image-path"] = currentImagePath.replaceAll('"', '');

      const imagePath = this.editForm["image-path"];
      if (!imagePath) {
        delete this.editForm["image-path"];
      } else if (!imagePath.toLowerCase().endsWith('.png')) {
        this.editFormError = this.$t('file_browser.error_invalid_extension', { extensions: '.png' });
        const modalBody = this.$refs.editModalBody
          || this.$refs.editModal?.querySelector?.('.kg-modal-body');
        if (modalBody) modalBody.scrollTop = 0;
        return;
      }

      apiFetch("./api/apps", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(this.editForm),
      }).then((r) => {
        if (r.status === 200) document.location.reload();
      });
    },
    handleImageError(event) {
      // Hide the broken image and show placeholder instead
      event.target.style.display = 'none';
      const placeholder = event.target.nextElementSibling;
      if (placeholder && placeholder.classList.contains('app-poster-placeholder')) {
        placeholder.style.display = 'flex';
      }
    },
    resetSearchQuery() {
      this.searchQuery = "";
    },
    toggleSort() {
      // Sorting goes default -> ascending -> descending -> default
      if (this.sortMode === "default")
        this.sortMode = "asc";
      else if (this.sortMode === "asc")
        this.sortMode = "desc";
      else
        this.sortMode = "default";
    },
    openEditModal() {
      this.editModalOpen = true;
    },
    closeEditModal() {
      this.editModalOpen = false;
    },
  },
}
</script>
