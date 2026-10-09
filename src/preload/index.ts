import { contextBridge, ipcRenderer } from 'electron';
import type { LauncherAPI, LauncherState } from '../shared/types';
const invoke = (name:string,...args:unknown[]) => ipcRenderer.invoke('launcher:'+name,...args);
const api:LauncherAPI={
  getState:()=>invoke('getState'),
  onState(listener){const handler=(_:Electron.IpcRendererEvent,state:LauncherState)=>listener(state);ipcRenderer.on('launcher:state',handler);return()=>ipcRenderer.removeListener('launcher:state',handler);},
  login:()=>invoke('login'),logout:()=>invoke('logout'),install:()=>invoke('install'),repair:()=>invoke('repair'),launch:()=>invoke('launch'),checkUpdates:()=>invoke('checkUpdates'),cancelOperation:()=>invoke('cancelOperation'),
  saveSettings:settings=>invoke('saveSettings',settings),chooseDirectory:()=>invoke('chooseDirectory'),choosePackArchive:()=>invoke('choosePackArchive'),openFolder:kind=>invoke('openFolder',kind),openExternal:url=>invoke('openExternal',url),
  minimize:()=>invoke('minimize'),maximize:()=>invoke('maximize'),close:()=>invoke('close')
};
contextBridge.exposeInMainWorld('launcher',api);
