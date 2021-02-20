import { addIcon, App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { Guid } from "guid-typescript";

interface AutoTextReplacePluginSettings {
	entries: SettingEntry[];
}

interface SettingEntry {
	id: Guid;
	matchStr: string;
	replacement: string;
	applyOnPaste: boolean;
	excludeCodeBlocks: boolean;
}

const DEFAULT_SETTINGS: AutoTextReplacePluginSettings = {
	entries: []
}

export default class AutoTextReplacePlugin extends Plugin {
	settings: AutoTextReplacePluginSettings;
	private prevCursorPosition: CodeMirror.Position;

	// cmEditors is used during unload to remove our event handlers.
	private cmEditors: CodeMirror.Editor[];

	async onload() {
		console.log('loading obsidian-auto-text-replace');

		await this.loadSettings();

		this.addSettingTab(new AutoTextReplaceSettingTab(this.app, this));

		this.cmEditors = [];
		this.registerCodeMirror((cm) => {
			this.cmEditors.push(cm);
			cm.on('keyup', this.handleKeyUp);
			cm.on('keydown', this.handleKeyDown);
		});

		addIcon('add', `
		<svg class="widget-icon" enable-background="new 0 0 24 24" viewBox="0 0 24 24" width="100" height="100" xmlns="http://www.w3.org/2000/svg">
			<path d="M11 11V7h2v4h4v2h-4v4h-2v-4H7v-2h4zm1 11C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
		</svg>
		`);
	}

	onunload() {
		console.log('unloading obsidian-auto-text-replace');

		this.cmEditors.forEach((cm) => {
			cm.off('keyup', this.handleKeyUp);
			cm.off('keydown', this.handleKeyDown);
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private readonly handleKeyUp = (
		editor: CodeMirror.Editor,
		event: KeyboardEvent,
	): void => {
		this.replaceWhileTyping(editor);
	};

	private replaceWhileTyping(editor: CodeMirror.Editor): void {
		const curCursorPosition = editor.getCursor();
		if (curCursorPosition.line !== this.prevCursorPosition.line || curCursorPosition.ch - this.prevCursorPosition.ch !== 1) {
			return;
		}
		const token = editor.getTokenAt({line: curCursorPosition.line, ch: editor.getTokenAt(curCursorPosition).start});
		if (!token) {
			return;
		}
		this.replaceToken(token, editor);
	}

	private replaceToken(token: CodeMirror.Token, editor: CodeMirror.Editor): void {
		const entry = this.settings.entries.filter(entry => entry.matchStr && entry.matchStr.trim().length > 0 && entry.matchStr === token?.string).first();
		if (!entry || (entry.excludeCodeBlocks && token.type?.contains('codeblock'))) {
			return;
		}
		editor.replaceRange(entry.replacement, { ch: token.start, line: editor.getCursor().line }, { ch: token.end, line: editor.getCursor().line });
	}

	private readonly handleKeyDown = (
		editor: CodeMirror.Editor,
		event: KeyboardEvent,
	): void => {
		this.prevCursorPosition = editor.getCursor();
	};
}

class AutoTextReplaceSettingTab extends PluginSettingTab {
	plugin: AutoTextReplacePlugin;
	private placeholder: Setting = null;

	constructor(app: App, plugin: AutoTextReplacePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setHeading()
			.setName('Text Replacements')
			.addExtraButton(extraButtonComponent => extraButtonComponent
				.setIcon('add')
				.setTooltip('Add a new text replacement entry')
				.onClick(async () => {
					const newEntry = {
						id: Guid.create(),
						matchStr: '',
						replacement: '',
						applyOnPaste: true,
						excludeCodeBlocks: true
					};
					this.plugin.settings.entries.push(newEntry);
					this.renderSettingEntry(newEntry, containerEl);
					this.placeholder.settingEl.hide();
					await this.plugin.saveSettings();
				}));

		this.placeholder = new Setting(containerEl)
			.setName('No text replacement entries set')
			.setDesc('To create one click the + icon in the upper right');

		if (this.plugin.settings.entries.length > 0) {
			this.placeholder.settingEl.hide();
		}

		this.plugin.settings.entries.forEach((settingEntry: SettingEntry) => {
			this.renderSettingEntry(settingEntry, containerEl);
		});
	}

	private renderSettingEntry(settingEntry: SettingEntry, containerEl: HTMLElement): void {
		let settingEl = new Setting(containerEl)
			.setName('Replacement')
			.addText(text => text
				.setValue(settingEntry.matchStr)
				.setPlaceholder('string to replace')
				.onChange(async (value) => {
					settingEntry.matchStr = value;
					await this.plugin.saveSettings();
				}))
			.then(setting => setting.controlEl.createSpan({ cls: 'spacer1' }))
			.then(setting => setting.controlEl.appendText('to'))
			.then(setting => setting.controlEl.createSpan({ cls: 'spacer1' }))
			.addText(text => text
				.setValue(settingEntry.replacement)
				.setPlaceholder('string to insert')
				.onChange(async (value) => {
					settingEntry.replacement = value;
					await this.plugin.saveSettings();
				}))
			.then(setting => setting.controlEl.createSpan({ cls: 'spacer3' }))
			.then(setting => setting.controlEl.appendText('Exclude code blocks:'))
			.then(setting => setting.controlEl.createSpan({ cls: 'spacer1' }))
			.addToggle(toggle => toggle
				.setValue(settingEntry.excludeCodeBlocks)
				.setTooltip('Whether to prevent this text replacement within code blocks')
				.onChange(async (value) => {
					settingEntry.excludeCodeBlocks = value;
					await this.plugin.saveSettings();
				}))
			.then(setting => setting.controlEl.createSpan({ cls: 'spacer1' }))
			.addExtraButton(extraButtonComponent => extraButtonComponent
				.setIcon('trash')
				.setTooltip('Remove this entry')
				.onClick(async () => {
					const entryToRemove = this.plugin.settings.entries.filter(entry => entry.id === settingEntry.id).first();
					if (!entryToRemove) {
						return;
					}
					this.plugin.settings.entries.remove(entryToRemove);
					settingEl.remove();
					if (this.plugin.settings.entries.length === 0) {
						this.placeholder.settingEl.show();
					}
					await this.plugin.saveSettings();
				})).settingEl;
	}
}