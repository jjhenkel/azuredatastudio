// Adopted and converted to typescript from https://github.com/danny-sg/slickgrid-spreadsheet-plugins/blob/master/ext.headerfilter.js
// heavily modified

import { IButtonOptions, IButtonStyles } from 'vs/base/browser/ui/button/button';
import { localize } from 'vs/nls';

import { Button } from 'sql/base/browser/ui/button/button';
import { FilterableColumn } from 'sql/base/browser/ui/table/interfaces';
import { addDisposableListener, EventType, EventHelper, $, isAncestor, clearNode, append } from 'vs/base/browser/dom';
import { Disposable, DisposableStore, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { withNullAsUndefined } from 'vs/base/common/types';
import { IDisposableDataProvider, instanceOfIDisposableDataProvider } from 'sql/base/common/dataProvider';
import { IContextViewProvider } from 'vs/base/browser/ui/contextview/contextview';
import { InputBox } from 'sql/base/browser/ui/inputBox/inputBox';
import { trapKeyboardNavigation } from 'sql/base/browser/dom';
import { IListAccessibilityProvider, IListStyles, List } from 'vs/base/browser/ui/list/listWidget';
import { IListRenderer, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { Checkbox } from 'sql/base/browser/ui/checkbox/checkbox';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Emitter } from 'vs/base/common/event';
import { CountBadge, ICountBadgeStyles } from 'vs/base/browser/ui/countBadge/countBadge';
import { IInputBoxStyles } from 'vs/base/browser/ui/inputbox/inputBox';

export type HeaderFilterCommands = 'sort-asc' | 'sort-desc';

export interface CommandEventArgs<T extends Slick.SlickData> {
	grid: Slick.Grid<T>,
	column: Slick.Column<T>,
	command: HeaderFilterCommands
}

export interface ITableFilterOptions extends ITableFilterStyles {
	/**
	 * The message to be displayed when the filter is disabled and the user tries to open the filter menu.
	 */
	disabledFilterMessage?: string;
	/**
	 * The columns are refreshed by default to add the filter menu button to the headers. The default value is true.
	 * Set to false to prevent the grid from being re-drawn multiple times by different plugins.
	 */
	refreshColumns?: boolean;
}

export interface ITableFilterStyles extends IInputBoxStyles, IListStyles, IButtonStyles, ICountBadgeStyles {
}

interface NotificationProvider {
	info(message: string): void;
}

const ShowFilterText: string = localize('headerFilter.showFilter', "Show Filter");

export const FilterButtonWidth: number = 34;

export class HeaderFilter<T extends Slick.SlickData> extends Disposable {

	public onFilterApplied = new Slick.Event<{ grid: Slick.Grid<T>, column: FilterableColumn<T> }>();
	public onCommand = new Slick.Event<CommandEventArgs<T>>();
	public enabled: boolean = true;

	private grid!: Slick.Grid<T>;
	private handler = new Slick.EventHandler();

	private menu?: HTMLElement;
	private okButton?: Button;
	private clearButton?: Button;
	private cancelButton?: Button;
	private selectAllCheckBox?: Checkbox;
	private searchInputBox?: InputBox;
	private countBadge?: CountBadge;
	private visibleCountBadge?: CountBadge;
	private list?: List<TableFilterListElement>;
	private listData?: TableFilterListElement[];
	private filteredListData?: TableFilterListElement[];
	private elementDisposables?: IDisposable[];
	private columnDef!: FilterableColumn<T>;
	private disposableStore = new DisposableStore();
	private columnButtonMapping: Map<string, HTMLElement> = new Map<string, HTMLElement>();
	private previouslyFocusedElement: HTMLElement;
	private listContainer?: HTMLElement;

	constructor(private readonly options: ITableFilterOptions, private readonly contextViewProvider: IContextViewProvider, private readonly notificationProvider?: NotificationProvider) {
		super();
	}

	public init(grid: Slick.Grid<T>): void {
		this.grid = grid;
		this.handler.subscribe(this.grid.onHeaderCellRendered, (e: Event, args: Slick.OnHeaderCellRenderedEventArgs<T>) => this.handleHeaderCellRendered(e, args))
			.subscribe(this.grid.onBeforeHeaderCellDestroy, (e: Event, args: Slick.OnBeforeHeaderCellDestroyEventArgs<T>) => this.handleBeforeHeaderCellDestroy(e, args))
			.subscribe(this.grid.onClick, (e: DOMEvent) => this.handleBodyMouseDown(e as MouseEvent))
			.subscribe(this.grid.onColumnsResized, () => this.columnsResized());

		if (this.options.refreshColumns !== false) {
			this.grid.setColumns(this.grid.getColumns());
		}

		this.disposableStore.add(addDisposableListener(document.body, 'mousedown', e => this.handleBodyMouseDown(e), true));
		this.disposableStore.add(addDisposableListener(document.body, 'keydown', e => this.handleKeyDown(e)));
	}

	public destroy() {
		this.handler.unsubscribeAll();
		this.disposableStore.dispose();
	}

	public async showMenu(): Promise<void> {
		const cell = this.grid.getActiveCell();
		if (cell) {
			const column = this.grid.getColumns()[cell.cell] as FilterableColumn<T>;
			if (column.filterable !== false && this.columnButtonMapping[column.id]) {
				await this.showFilter(this.columnButtonMapping[column.id]);
			}
		}
	}

	private handleKeyDown(e: KeyboardEvent): void {
		const event = new StandardKeyboardEvent(e);
		if (this.menu && event.keyCode === KeyCode.Escape) {
			this.hideMenu();
			if (this.previouslyFocusedElement?.focus && this.previouslyFocusedElement.tabIndex !== -1) {
				this.previouslyFocusedElement?.focus();
			}
			EventHelper.stop(e, true);
		}
	}

	private handleBodyMouseDown(e: MouseEvent): void {
		if (this.menu && this.menu !== e.target && !isAncestor(e.target as Element, this.menu)) {
			this.hideMenu();
		}
	}

	private hideMenu() {
		this.contextViewProvider.hideContextView();
	}

	private handleHeaderCellRendered(e: Event, args: Slick.OnHeaderCellRenderedEventArgs<T>) {
		const column = args.column as FilterableColumn<T>;
		if ((<FilterableColumn<T>>column).filterable === false) {
			return;
		}
		if (args.node.classList.contains('slick-header-with-filter')) {
			// the the filter button has already being added to the header
			return;
		}

		// The default sorting feature is triggered by clicking on the column header, but that is conflicting with query editor grid,
		// For query editor grid when column header is clicked, the entire column will be selected.
		// If the column is not defined as sortable because of the above reason, we will add the sort indicator here.
		if (column.sortable !== true) {
			args.node.classList.add('slick-header-sortable');
			append(args.node, $('span.slick-sort-indicator'));
		}

		args.node.classList.add('slick-header-with-filter');
		const $el = jQuery(`<button tabindex="-1" aria-label="${ShowFilterText}" title="${ShowFilterText}"></button>`)
			.addClass('slick-header-menubutton')
			.data('column', column);
		this.setButtonImage($el, column.filterValues?.length > 0);

		$el.click(async (e: JQuery.Event) => {
			e.stopPropagation();
			e.preventDefault();
			await this.showFilter($el[0]);
		});
		$el.appendTo(args.node);

		this.columnButtonMapping[column.id] = $el[0];
	}

	private handleBeforeHeaderCellDestroy(e: Event, args: Slick.OnBeforeHeaderCellDestroyEventArgs<T>) {
		jQuery(args.node)
			.find('.slick-header-menubutton')
			.remove();
	}

	private createButtonMenuItem(title: string, command: HeaderFilterCommands, iconClass: string): Button {
		const buttonContainer = append(this.menu, $('.slick-header-menu-image-button-container'));
		const button = new Button(buttonContainer, this.options);
		button.icon = `slick-header-menuicon ${iconClass}`;
		button.label = title;
		button.onDidClick(async () => {
			await this.handleMenuItemClick(command, this.columnDef);
		});
		return button;
	}

	private createSearchInputRow(): void {
		const searchRow = append(this.menu, $('.searchbox-row'));
		this.selectAllCheckBox = new Checkbox(append(searchRow, $('.select-all-checkbox')), {
			onChange: (val) => {
				this.filteredListData.forEach(item => {
					item.checked = val;
				});
			},
			label: '',
			ariaLabel: localize('table.selectAll', "Select All")
		});


		this.searchInputBox = this._register(new InputBox(append(searchRow, $('.search-input')), this.contextViewProvider, {
			placeholder: localize('table.searchPlaceHolder', "Search"),
			inputBoxStyles: this.options
		}));
		const visibleCountContainer = append(searchRow, $('.visible-count'));
		visibleCountContainer.setAttribute('aria-live', 'polite');
		visibleCountContainer.setAttribute('aria-atomic', 'true');
		this.visibleCountBadge = new CountBadge(visibleCountContainer, {
			countFormat: localize({ key: 'tableFilter.visibleCount', comment: ['This tells the user how many items are shown in the list. Currently not visible, but read by screen readers.'] }, "{0} Results")
		}, this.options);

		const selectedCountBadgeContainer = append(searchRow, $('.selected-count'));
		selectedCountBadgeContainer.setAttribute('aria-live', 'polite');
		this.countBadge = new CountBadge(selectedCountBadgeContainer, {
			countFormat: localize({ key: 'tableFilter.selectedCount', comment: ['This tells the user how many items are selected in the list'] }, "{0} Selected")
		}, this.options);

		this._register(this.searchInputBox.onDidChange(async (newString) => {
			this.filteredListData = this.listData.filter(element => element.value?.toUpperCase().indexOf(newString.toUpperCase()) !== -1);
			this.list.splice(0, this.list.length, this.filteredListData);
			this.updateSelectionState();
		}));
	}

	private async createFilterList(): Promise<void> {
		this.columnDef.filterValues = this.columnDef.filterValues || [];

		// WorkingFilters is a copy of the filters to enable apply/cancel behaviour
		const workingFilters = this.columnDef.filterValues.slice(0);
		let filterItems: Array<string>;
		const dataView = this.grid.getData() as Slick.DataProvider<T>;
		if (instanceOfIDisposableDataProvider(dataView)) {
			filterItems = await (dataView as IDisposableDataProvider<T>).getColumnValues(this.columnDef);
		} else {
			const filterApplied = this.grid.getColumns().findIndex((col) => {
				const filterableColumn = col as FilterableColumn<T>;
				return filterableColumn.filterValues?.length > 0;
			}) !== -1;
			if (!filterApplied) {
				// Filter based all available values
				filterItems = this.getFilterValues(this.grid.getData() as Slick.DataProvider<T>, this.columnDef);
			}
			else {
				// Filter based on current dataView subset
				filterItems = this.getAllFilterValues((this.grid.getData() as Slick.Data.DataView<T>).getFilteredItems(), this.columnDef);
			}
		}

		// Sort the list to make it easier to find a string
		filterItems.sort();

		// Promote undefined (NULL) to be always at the top of the list
		const nullValueIndex = filterItems.indexOf(undefined);
		if (nullValueIndex !== -1) {
			filterItems.splice(nullValueIndex, 1);
			filterItems.unshift(undefined);
		}

		this.listData = [];
		for (let i = 0; i < filterItems.length; i++) {
			const filtered = workingFilters.some(x => x === filterItems[i]);
			// work item to remove the 'Error:' string check: https://github.com/microsoft/azuredatastudio/issues/15206
			const filterItem = filterItems[i];
			if (!filterItem || filterItem.indexOf('Error:') < 0) {
				let element = new TableFilterListElement(filterItem, filtered);
				this._register(element);
				this.listData.push();
			}
		}

		this.elementDisposables = this.listData.map(element => {
			return element.onCheckStateChanged((e) => {
				this.updateSelectionState();
			});
		});

		this.filteredListData = this.listData;

		this.listContainer = append(this.menu, $('.filter'));
		this.list = new List<TableFilterListElement>('TableFilter', this.listContainer, new TableFilterListDelegate(), [new TableFilterListRenderer()], {
			multipleSelectionSupport: false,
			keyboardSupport: true,
			mouseSupport: true,
			accessibilityProvider: new TableFilterListAccessibilityProvider()
		});
		this.list.onKeyDown((e) => {
			const event = new StandardKeyboardEvent(e);
			switch (event.keyCode) {
				case KeyCode.Home:
					if (this.filteredListData.length > 0) {
						this.list.focusFirst();
						this.list.reveal(0);
						EventHelper.stop(e, true);
					}
					break;
				case KeyCode.End:
					if (this.filteredListData.length > 0) {
						this.list.focusLast();
						this.list.reveal(this.filteredListData.length - 1);
						EventHelper.stop(e, true);
					}
					break;
				case KeyCode.Space:
					if (this.list.getFocus().length !== 0) {
						this.list.setSelection(this.list.getFocus());
						this.toggleCheckbox();
						EventHelper.stop(e, true);
					}
					break;
			}
		});
		this.list.splice(0, this.filteredListData.length, this.filteredListData);
		this.updateSelectionState();
	}

	private createButton(container: HTMLElement, id: string, text: string, options?: IButtonOptions): Button {
		const buttonContainer = append(container, $('.filter-menu-button'));
		const button = new Button(buttonContainer, options);
		button.label = button.title = text;
		button.element.id = id;
		return button;
	}

	private toggleCheckbox(): void {
		if (this.list.getFocus().length !== 0) {
			const element = this.list.getFocusedElements()[0];
			element.checked = !element.checked;
			this.updateSelectionState();
		}
	}

	private updateSelectionState() {
		const checkedElements = this.filteredListData.filter(element => element.checked);
		this.selectAllCheckBox.checked = this.filteredListData.length > 0 && checkedElements.length === this.filteredListData.length;
		this.countBadge.setCount(checkedElements.length);
		this.visibleCountBadge.setCount(this.filteredListData.length);
	}

	private async showFilter(filterButton: HTMLElement): Promise<void> {
		if (!this.enabled) {
			if (this.notificationProvider && this.options?.disabledFilterMessage) {
				this.notificationProvider.info(this.options.disabledFilterMessage);
			}
			return;
		}
		this.previouslyFocusedElement = document.activeElement as HTMLElement;
		await this.createFilterMenu(filterButton);
		// Try to fit the menu in the screen.
		// We don't really consider the case when there is not enough space to show the entire menu since in that case the application is not usable already.

		const offset = jQuery(filterButton).offset();
		// If there is not enough vertical space under the filter button, we will move up the menu.
		const menuTop = offset.top + this.menu.offsetHeight <= window.innerHeight ? offset.top : window.innerHeight - this.menu.offsetHeight;
		// Make sure the menu is on the screen horizontally.
		const menuLeft = offset.left + filterButton.offsetWidth + this.menu.offsetWidth <= window.innerWidth ? offset.left + filterButton.offsetWidth : window.innerWidth - this.menu.offsetWidth;

		this.contextViewProvider.showContextView({
			getAnchor: () => {
				return {
					x: menuLeft,
					y: menuTop
				};
			},
			render: (container: HTMLElement) => {
				container.appendChild(this.menu);
				// Set the list size to its container size so that scrolling works correctly..
				this.list.layout(this.listContainer.clientHeight);
				return {
					dispose: () => {
						this.disposeMenu();
					}
				};
			},
			focus: () => {
				this.okButton.focus();
			}
		});
	}

	private disposeMenu(): void {
		if (this.menu) {
			clearNode(this.menu);
			this.menu.remove();
			this.menu = undefined;
			dispose(this.elementDisposables);
		}
	}

	private async createFilterMenu(filterButton: HTMLElement) {
		const target = withNullAsUndefined(filterButton);
		const $menuButton = jQuery(target);
		this.columnDef = $menuButton.data('column');

		this.disposeMenu();

		// first add it to the document so that we can get the actual size of the menu
		// later, it will be added to the correct container
		this.menu = append(document.body, $('.slick-header-menu'));
		const MenuVerticalPadding = 10;
		const MenuBarHeight = 30;
		const DefaultMenuHeight = 350;
		// Make sure the menu can fit in the screen.
		this.menu.style.height = `${Math.min(DefaultMenuHeight, window.innerHeight - MenuBarHeight) - MenuVerticalPadding}px`;

		this.createButtonMenuItem(localize('table.sortAscending', "Sort Ascending"), 'sort-asc', 'ascending');
		this.createButtonMenuItem(localize('table.sortDescending', "Sort Descending"), 'sort-desc', 'descending');

		this.createSearchInputRow();
		await this.createFilterList();

		const buttonGroupContainer = append(this.menu, $('.filter-menu-button-container'));
		this.okButton = this.createButton(buttonGroupContainer, 'filter-ok-button', localize('headerFilter.ok', "OK"), this.options);
		this.okButton.onDidClick(async () => {
			this.columnDef.filterValues = this.listData.filter(element => element.checked).map(element => element.value);
			this.setButtonImage($menuButton, this.columnDef.filterValues.length > 0);
			await this.handleApply(this.columnDef);
		});

		this.clearButton = this.createButton(buttonGroupContainer, 'filter-clear-button', localize('headerFilter.clear', "Clear"), { secondary: true, ...this.options });
		this.clearButton.onDidClick(async () => {
			this.columnDef.filterValues!.length = 0;
			this.setButtonImage($menuButton, false);
			await this.handleApply(this.columnDef);
		});

		this.cancelButton = this.createButton(buttonGroupContainer, 'filter-cancel-button', localize('headerFilter.cancel', "Cancel"), { secondary: true, ...this.options });
		this.cancelButton.onDidClick(() => {
			this.hideMenu();
		});
		// No need to add this to disposable store, it will be disposed when the menu is closed.
		trapKeyboardNavigation(this.menu);
	}

	private columnsResized() {
		this.hideMenu();
	}

	private setButtonImage($el: JQuery<HTMLElement>, filtered: boolean) {
		const element: HTMLElement = $el.get(0);
		if (filtered) {
			element.className += ' filtered';
		} else {
			const classList = element.classList;
			if (classList.contains('filtered')) {
				classList.remove('filtered');
			}
		}
	}

	private async handleApply(columnDef: Slick.Column<T>) {
		this.hideMenu();
		const dataView = this.grid.getData();
		if (instanceOfIDisposableDataProvider(dataView)) {
			await (dataView as IDisposableDataProvider<T>).filter(this.grid.getColumns());
			this.grid.invalidateAllRows();
			this.grid.updateRowCount();
			this.grid.render();
		}
		this.onFilterApplied.notify({ grid: this.grid, column: columnDef });
		this.setFocusToColumn(columnDef);
	}

	private getFilterValues(dataView: Slick.DataProvider<T>, column: Slick.Column<T>): Array<any> {
		const seen: Set<string> = new Set();
		dataView.getItems().forEach(items => {
			const value = items[column.field!];
			const valueArr = value instanceof Array ? value : [value];
			valueArr.forEach(v => seen.add(v));
		});

		return Array.from(seen);
	}

	private getAllFilterValues(data: Array<T>, column: Slick.Column<T>) {
		const seen: Set<any> = new Set();

		data.forEach(items => {
			const value = items[column.field!];
			const valueArr = value instanceof Array ? value : [value];
			valueArr.forEach(v => seen.add(v));
		});

		return Array.from(seen).sort((v) => { return v; });
	}

	private async handleMenuItemClick(command: HeaderFilterCommands, columnDef: Slick.Column<T>) {
		this.hideMenu();
		const dataView = this.grid.getData();
		if (command === 'sort-asc' || command === 'sort-desc') {
			this.grid.setSortColumn(columnDef.id, command === 'sort-asc');
		}
		if (instanceOfIDisposableDataProvider<T>(dataView) && (command === 'sort-asc' || command === 'sort-desc')) {
			await dataView.sort({
				grid: this.grid,
				multiColumnSort: false,
				sortCol: this.columnDef,
				sortAsc: command === 'sort-asc'
			});
			this.grid.invalidateAllRows();
			this.grid.updateRowCount();
			this.grid.render();
		}

		this.onCommand.notify({
			grid: this.grid,
			column: columnDef,
			command: command
		});

		this.setFocusToColumn(columnDef);
	}

	private setFocusToColumn(columnDef): void {
		if (this.grid.getDataLength() > 0) {
			const column = this.grid.getColumns().findIndex(col => col.id === columnDef.id);
			if (column >= 0) {
				this.grid.setActiveCell(0, column);
			}
		}
	}
}

class TableFilterListElement extends Disposable {
	private readonly _onCheckStateChanged = this._register(new Emitter<boolean>());
	private _checked: boolean;

	constructor(val: string, checked: boolean) {
		super();
		this.value = val;
		this._checked = checked;

		// Handle the values that are visually hard to differentiate.
		if (val === undefined) {
			this.displayText = localize('tableFilter.nullDisplayText', "(NULL)");
		} else if (val === '') {
			this.displayText = localize('tableFilter.blankStringDisplayText', "(Blanks)");
		} else {
			this.displayText = val;
		}
	}

	public displayText: string;
	public value: string;

	public onCheckStateChanged = this._onCheckStateChanged.event;

	public get checked(): boolean {
		return this._checked;
	}
	public set checked(val: boolean) {
		if (this._checked !== val) {
			this._checked = val;
			this._onCheckStateChanged.fire(val);
		}
	}
}

const TableFilterTemplateId = 'TableFilterListTemplate';
class TableFilterListDelegate implements IListVirtualDelegate<TableFilterListElement> {
	getHeight(element: TableFilterListElement): number {
		return 22;
	}

	getTemplateId(element: TableFilterListElement): string {
		return TableFilterTemplateId;
	}
}

interface TableFilterListItemTemplate {
	checkbox: HTMLInputElement;
	text: HTMLDivElement;
	label: HTMLLabelElement;
	element: TableFilterListElement;
	elementDisposables: IDisposable[];
	templateDisposables: IDisposable[];
}

class TableFilterListRenderer implements IListRenderer<TableFilterListElement, TableFilterListItemTemplate> {
	renderTemplate(container: HTMLElement): TableFilterListItemTemplate {
		const data: TableFilterListItemTemplate = Object.create(null);
		data.templateDisposables = [];
		data.elementDisposables = [];
		data.label = append(container, $<HTMLLabelElement>('label.filter-option'));
		data.checkbox = append(data.label, $<HTMLInputElement>('input', {
			'type': 'checkbox',
			'tabIndex': -1
		}));
		data.text = append(data.label, $<HTMLDivElement>('div'));
		data.text.style.flex = '1 1 auto';
		data.templateDisposables.push(addDisposableListener(data.checkbox, EventType.CHANGE, (event) => {
			data.element.checked = data.checkbox.checked;
		}));
		return data;
	}

	renderElement(element: TableFilterListElement, index: number, templateData: TableFilterListItemTemplate, height: number): void {
		templateData.element = element;
		templateData.elementDisposables = dispose(templateData.elementDisposables);
		templateData.elementDisposables.push(templateData.element.onCheckStateChanged((e) => {
			templateData.checkbox.checked = e;
		}));
		templateData.checkbox.checked = element.checked;
		templateData.checkbox.setAttribute('aria-label', element.displayText);
		templateData.text.innerText = element.displayText;
		templateData.label.title = element.displayText;
		// Use italic to match the style that NULL value is displayed in the grid.
		templateData.label.style.fontStyle = element.displayText === element.value ? 'normal' : 'italic';
	}

	disposeElement?(element: TableFilterListElement, index: number, templateData: TableFilterListItemTemplate, height: number): void {
		templateData.elementDisposables = dispose(templateData.elementDisposables);
	}

	public disposeTemplate(templateData: TableFilterListItemTemplate): void {
		templateData.elementDisposables = dispose(templateData.elementDisposables);
		templateData.templateDisposables = dispose(templateData.templateDisposables);
	}

	public get templateId(): string {
		return TableFilterTemplateId;
	}
}

class TableFilterListAccessibilityProvider implements IListAccessibilityProvider<TableFilterListElement> {
	getAriaLabel(element: TableFilterListElement): string {
		return element.value;
	}

	getWidgetAriaLabel(): string {
		return localize('table.filterOptions', "Filter Options");
	}

	getWidgetRole() {
		return 'listbox';
	}

	getRole(element: TableFilterListElement): string {
		return 'option';
	}
}


