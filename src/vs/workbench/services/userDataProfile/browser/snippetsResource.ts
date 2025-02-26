/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { IStringDictionary } from 'vs/base/common/collections';
import { ResourceSet } from 'vs/base/common/map';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { FileOperationError, FileOperationResult, IFileService, IFileStat } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity';
import { IUserDataProfile } from 'vs/platform/userDataProfile/common/userDataProfile';
import { API_OPEN_EDITOR_COMMAND_ID } from 'vs/workbench/browser/parts/editor/editorCommands';
import { ITreeItemCheckboxState, TreeItemCollapsibleState } from 'vs/workbench/common/views';
import { IProfileResource, IProfileResourceChildTreeItem, IProfileResourceInitializer, IProfileResourceTreeItem, IUserDataProfileService, ProfileResourceType } from 'vs/workbench/services/userDataProfile/common/userDataProfile';

interface ISnippetsContent {
	snippets: IStringDictionary<string>;
}

export class SnippetsResourceInitializer implements IProfileResourceInitializer {

	constructor(
		@IUserDataProfileService private readonly userDataProfileService: IUserDataProfileService,
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
	) {
	}

	async initialize(content: string): Promise<void> {
		const snippetsContent: ISnippetsContent = JSON.parse(content);
		for (const key in snippetsContent.snippets) {
			const resource = this.uriIdentityService.extUri.joinPath(this.userDataProfileService.currentProfile.snippetsHome, key);
			await this.fileService.writeFile(resource, VSBuffer.fromString(snippetsContent.snippets[key]));
		}
	}
}

export class SnippetsResource implements IProfileResource {

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
	) {
	}

	async getContent(profile: IUserDataProfile, excluded?: ResourceSet): Promise<string> {
		const snippets = await this.getSnippets(profile, excluded);
		return JSON.stringify({ snippets });
	}

	async apply(content: string, profile: IUserDataProfile): Promise<void> {
		const snippetsContent: ISnippetsContent = JSON.parse(content);
		for (const key in snippetsContent.snippets) {
			const resource = this.uriIdentityService.extUri.joinPath(profile.snippetsHome, key);
			await this.fileService.writeFile(resource, VSBuffer.fromString(snippetsContent.snippets[key]));
		}
	}

	private async getSnippets(profile: IUserDataProfile, excluded?: ResourceSet): Promise<IStringDictionary<string>> {
		const snippets: IStringDictionary<string> = {};
		const snippetsResources = await this.getSnippetsResources(profile, excluded);
		for (const resource of snippetsResources) {
			const key = this.uriIdentityService.extUri.relativePath(profile.snippetsHome, resource)!;
			const content = await this.fileService.readFile(resource);
			snippets[key] = content.value.toString();
		}
		return snippets;
	}

	async getSnippetsResources(profile: IUserDataProfile, excluded?: ResourceSet): Promise<URI[]> {
		const snippets: URI[] = [];
		let stat: IFileStat;
		try {
			stat = await this.fileService.resolve(profile.snippetsHome);
		} catch (e) {
			// No snippets
			if (e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return snippets;
			} else {
				throw e;
			}
		}
		for (const { resource } of stat.children || []) {
			if (excluded?.has(resource)) {
				continue;
			}
			const extension = this.uriIdentityService.extUri.extname(resource);
			if (extension === '.json' || extension === '.code-snippets') {
				snippets.push(resource);
			}
		}
		return snippets;
	}
}

export class SnippetsResourceTreeItem implements IProfileResourceTreeItem {

	readonly type = ProfileResourceType.Snippets;
	readonly handle = this.profile.snippetsHome.toString();
	readonly label = { label: localize('snippets', "Snippets") };
	readonly collapsibleState = TreeItemCollapsibleState.Collapsed;
	checkbox: ITreeItemCheckboxState | undefined;

	private readonly excludedSnippets = new ResourceSet();

	constructor(
		private readonly profile: IUserDataProfile,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	async getChildren(): Promise<IProfileResourceChildTreeItem[] | undefined> {
		const snippetsResources = await this.instantiationService.createInstance(SnippetsResource).getSnippetsResources(this.profile);
		const that = this;
		return snippetsResources.map<IProfileResourceChildTreeItem>(resource => ({
			handle: resource.toString(),
			parent: that,
			resourceUri: resource,
			collapsibleState: TreeItemCollapsibleState.None,
			checkbox: that.checkbox ? {
				get isChecked() { return !that.excludedSnippets.has(resource); },
				set isChecked(value: boolean) {
					if (value) {
						that.excludedSnippets.delete(resource);
					} else {
						that.excludedSnippets.add(resource);
					}
				}
			} : undefined,
			command: {
				id: API_OPEN_EDITOR_COMMAND_ID,
				title: '',
				arguments: [resource, undefined, undefined]
			}
		}));
	}

	async hasContent(): Promise<boolean> {
		const snippetsResources = await this.instantiationService.createInstance(SnippetsResource).getSnippetsResources(this.profile);
		return snippetsResources.length > 0;
	}

	async getContent(): Promise<string> {
		return this.instantiationService.createInstance(SnippetsResource).getContent(this.profile, this.excludedSnippets);
	}

}

