import { Plugin, ItemView, MarkdownRenderChild } from "obsidian";
import { mountMap } from "./mount.js";
import { PARAMS as DEFAULTS } from "./config.js";
import { merge } from "./settings-schema.js";
import HolomapSettingTab from "./settings.js";

const VIEW_TYPE = "holomap-view";

class HolomapView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Holographic map"; }
  getIcon() { return "globe"; }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("holomap-container");
    try {
      this._instance = await mountMap(container, this.app, this.plugin.settings);
    } catch (e) {
      // Never a bare throw: an empty panel is undebuggable for the user.
      container.createEl("p", { text: "vault map — error: " + (e && e.message ? e.message : String(e)) });
    }
  }

  async onClose() {
    if (this._instance) this._instance.detach();
  }
}

class HolomapBlock extends MarkdownRenderChild {
  constructor(containerEl, app, plugin) {
    super(containerEl);
    this.app = app;
    this.plugin = plugin;
  }

  async onload() {
    this.containerEl.addClass("holomap-container");
    try {
      this._instance = await mountMap(this.containerEl, this.app, this.plugin.settings);
    } catch (e) {
      this.containerEl.createEl("p", { text: "vault map — error: " + (e && e.message ? e.message : String(e)) });
    }
  }

  onunload() {
    if (this._instance) this._instance.detach();
  }
}

export default class HolomapPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, leaf => new HolomapView(leaf, this));
    this.addSettingTab(new HolomapSettingTab(this.app, this));

    this.addRibbonIcon("globe", "Open the holographic map", () => this.openView());
    this.addCommand({
      id: "open-holomap",
      name: "Open the holographic map",
      callback: () => this.openView(),
    });

    this.registerMarkdownCodeBlockProcessor("holomap", (source, el, ctx) => {
      ctx.addChild(new HolomapBlock(el, this.app, this));
    });
  }

  async openView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing || workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }

  // Saved settings are never more than a partial OVERRIDE: merge() recombines
  // them leaf by leaf with config.js's defaults, so a field missing from
  // data.json (a new setting added since) falls back to its default instead
  // of crashing or silently disappearing.
  async loadSettings() {
    const saved = await this.loadData();
    this.settings = merge(DEFAULTS, saved);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
