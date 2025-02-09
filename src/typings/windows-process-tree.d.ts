/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Copied from the `@vscode/windows-process-tree` package.
// The dependency is an optional dependency that is only used on Windows,
// but we need the typings to compile on all platforms.
// The `@types/windows-process-tree` package has also been deprecated.
declare module '@vscode/windows-process-tree' {
	export enum ProcessDataFlag { }

	export interface IProcessInfo {
		pid: number;
		ppid: number;
		name: string;

		/**
		 * The working set size of the process, in bytes.
		 */
		memory?: number;

		/**
		 * The string returned is at most 512 chars, strings exceeding this length are truncated.
		 */
		commandLine?: string;
	}

	export interface IProcessCpuInfo extends IProcessInfo {
		cpu?: number;
	}

	export interface IProcessTreeNode {
		pid: number;
		name: string;
		memory?: number;
		commandLine?: string;
		children: IProcessTreeNode[];
	}

	/**
	 * Returns a tree of processes with the rootPid process as the root.
	 * @param rootPid - The pid of the process that will be the root of the tree.
	 * @param callback - The callback to use with the returned list of processes.
	 * @param flags - The flags for what process data should be included.
	 */
	export function getProcessTree(rootPid: number, callback: (tree: IProcessTreeNode | undefined) => void, flags?: ProcessDataFlag): void;

	namespace getProcessTree {
		function __promisify__(rootPid: number, flags?: ProcessDataFlag): Promise<IProcessTreeNode>;
	}

	/**
	 * Returns a list of processes containing the rootPid process and all of its descendants.
	 * @param rootPid - The pid of the process of interest.
	 * @param callback - The callback to use with the returned set of processes.
	 * @param flags - The flags for what process data should be included.
	 */
	export function getProcessList(rootPid: number, callback: (processList: IProcessInfo[] | undefined) => void, flags?: ProcessDataFlag): void;

	namespace getProcessList {
		function __promisify__(rootPid: number, flags?: ProcessDataFlag): Promise<IProcessInfo[]>;
	}

	/**
	 * Returns the list of processes annotated with cpu usage information.
	 * @param processList - The list of processes.
	 * @param callback - The callback to use with the returned list of processes.
	 */
	export function getProcessCpuUsage(processList: IProcessInfo[], callback: (processListWithCpu: IProcessCpuInfo[]) => void): void;

	namespace getProcessCpuUsage {
		function __promisify__(processList: IProcessInfo[]): Promise<IProcessCpuInfo[]>;
	}
}
