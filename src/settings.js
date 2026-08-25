import { PluginSettingTab, Setting, setIcon } from "obsidian";
import { PARAMS as DEFAULTS } from "./config.js";
import { isGroup, read, write, clone, typeOf } from "./settings-schema.js";
import {
  GROUP_LABELS, GROUP_ICONS, labelFor, descFor, boundsFor, searchFilter,
} from "./settings-meta.js";

function titleFor(key) { return GROUP_LABELS[key] || key; }

export default class HolomapSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    // DOM references rebuilt on every render, consumed by the search filter.
    this.groupEls = new Map();
    this.fieldEls = new Map();

    containerEl.createEl("h2", { text: "Holomap — settings" });
    containerEl.createEl("p", {
      text: "A change here applies the next time the map is built (reopen the view, or revisit the note holding the holomap block).",
      cls: "setting-item-description",
    });

    // Search bar: live-filters by label / technical name / description.
    const search = new Setting(containerEl)
      .setName("Search")
      .addSearch(s => {
        s.setPlaceholder("Filter settings…");
        s.onChange(v => this.applyFilter(v));
      });
    search.settingEl.addClass("holomap-search");

    new Setting(containerEl)
      .setName("Reset all settings")
      .setDesc("Restore every value to its default.")
      .addButton(b => b.setButtonText("Reset").setWarning().onClick(async () => {
        this.plugin.settings = clone(DEFAULTS);
        await this.plugin.saveSettings();
        this.display();
      }));

    this.renderGroup(containerEl, DEFAULTS, []);
  }

  // Renders a group: direct leaves as Setting(), sub-groups as collapsible
  // sections. Recursive, purely derived from the SHAPE of DEFAULTS (config.js).
  renderGroup(host, groupDefaults, path) {
    for (const key of Object.keys(groupDefaults)) {
      const value = groupDefaults[key];
      const leafPath = [...path, key];
      if (isGroup(value)) {
        const details = host.createEl("details", { cls: "holomap-group" });
        if (path.length === 0) details.setAttr("open", "");
        const summary = details.createEl("summary");
        const icon = summary.createSpan({ cls: "holomap-group-icon" });
        setIcon(icon, GROUP_ICONS[key] || "settings");
        summary.createSpan({ text: titleFor(key) });
        this.groupEls.set(leafPath.join("."), details);
        this.renderGroup(details, value, leafPath);
      } else if (typeOf(value) !== "unknown") {
        // Mirrors the silent skip in leaves(): a leaf of unknown type (e.g. a
        // future string value) stays ignored here exactly like in the search
        // index, instead of the two contradicting each other.
        this.renderField(host, leafPath, value);
      }
    }
  }

  renderField(host, path, defaultValue) {
    const current = read(this.plugin.settings, path);
    const value = current === undefined ? defaultValue : current;
    const technicalName = path[path.length - 1];
    const field = new Setting(host)
      .setName(labelFor(path, technicalName))
      .setDesc(descFor(path));
    this.fieldEls.set(path.join("."), field.settingEl);

    if (typeof defaultValue === "boolean") {
      field.addToggle(t => t.setValue(value).onChange(async v => {
        write(this.plugin.settings, path, v);
        await this.plugin.saveSettings();
      }));
    } else if (Array.isArray(defaultValue)) {
      field.addText(t => t.setValue(value.join(", ")).onChange(async v => {
        const arr = v.split(",").map(x => Number(x.trim())).filter(x => !Number.isNaN(x));
        write(this.plugin.settings, path, arr);
        await this.plugin.saveSettings();
      }));
    } else {
      const { min, max, step } = boundsFor(path, "number", defaultValue);
      field.addSlider(s => s
        .setLimits(min, max, step)
        .setValue(Math.min(Math.max(value, min), max))
        .setDynamicTooltip()
        .onChange(async v => {
          write(this.plugin.settings, path, v);
          await this.plugin.saveSettings();
        }));
    }
  }

  // Search: null → default view (root open, sub-groups closed, everything
  // visible). Otherwise hide non-matching fields and groups, and open the
  // groups that contain a match.
  applyFilter(text) {
    const filter = searchFilter(DEFAULTS, text);
    if (!filter) {
      for (const [key, el] of this.groupEls) {
        el.style.display = "";
        if (key.includes(".")) el.removeAttribute("open"); else el.setAttr("open", "");
      }
      for (const el of this.fieldEls.values()) el.style.display = "";
      return;
    }
    for (const [key, el] of this.fieldEls) {
      el.style.display = filter.visibleFields.has(key) ? "" : "none";
    }
    for (const [key, el] of this.groupEls) {
      const visible = filter.visibleGroups.has(key);
      el.style.display = visible ? "" : "none";
      if (visible) el.setAttr("open", ""); else el.removeAttribute("open");
    }
  }
}
