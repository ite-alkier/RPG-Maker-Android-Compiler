const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectProject: (payload) => ipcRenderer.invoke('project:select', payload),
  importProject: (payload) => ipcRenderer.invoke('project:import', payload),
  getWorkDir: () => ipcRenderer.invoke('app:getWorkDir'),
  getLanguageBundle: () => ipcRenderer.invoke('app:getLanguageBundle'),
  showMvNotice: (payload) => ipcRenderer.invoke('app:showMvNotice', payload),
  setAppLanguage: (lang) => ipcRenderer.send('app:setLanguage', lang),
  prepareCapacitor: (payload) => ipcRenderer.invoke('project:prepareCapacitor', payload),
  selectIcon: (payload) => ipcRenderer.invoke('project:selectIcon', payload),
  selectApkOutputDir: (payload) => ipcRenderer.invoke('project:selectApkOutputDir', payload),
  zipAndroidProject: (payload) => ipcRenderer.invoke('project:zipAndroidProject', payload),
  buildApk: (payload) => ipcRenderer.invoke('project:buildApk', payload),
  onBuildLog: (callback) => {
    ipcRenderer.on('build:log', (event, data) => callback(data));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update:progress', (event, data) => callback(data));
  },
});
