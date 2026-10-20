'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petAPI', {
  getBootstrap: () => ipcRenderer.invoke('pet:get-bootstrap'),

  onState(callback) {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('pet:state', handler)
    return () => ipcRenderer.removeListener('pet:state', handler)
  },

  onPacks(callback) {
    const handler = (_event, packs) => callback(packs)
    ipcRenderer.on('pet:packs', handler)
    return () => ipcRenderer.removeListener('pet:packs', handler)
  },

  onReaction(callback) {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('pet:reaction', handler)
    return () => ipcRenderer.removeListener('pet:reaction', handler)
  },

  setIgnoreMouse(ignore) {
    ipcRenderer.send('pet:set-ignore-mouse', ignore)
  },

  dragStart(point) {
    ipcRenderer.send('pet:drag-start', point)
  },

  dragMove(point) {
    ipcRenderer.send('pet:drag-move', point)
  },

  dragEnd() {
    ipcRenderer.send('pet:drag-end')
  },

  showContextMenu() {
    ipcRenderer.send('pet:show-context-menu')
  },

  reloadPacks() {
    return ipcRenderer.invoke('pet:reload-packs')
  },

  openDsh() {
    ipcRenderer.send('pet:open-dsh')
  },

  hide() {
    ipcRenderer.send('pet:hide')
  },

  quit() {
    ipcRenderer.send('pet:quit')
  },
})
