const gameIdsElements = document.querySelectorAll('[data-game-ids]');
for (let el of gameIdsElements) {
  if (el.dataset.gameIds.split(',').indexOf(gameId) > -1)
    el.style.display = '';
  else
    el.remove();
}

let localizedMessages;
let localizedMapLocations;
let mapLocations;
let localizedLocationUrlRoot;
let locationUrlRoot;

const langLabelMassageFunctions = {
  'ja': (value, isUI) => {
    if (isUI && value.indexOf(' ') > -1)
      return value.split(/ +/g).map(v => `<span class="nowrap">${v}</span>`).join('');
    return value;
  },
  'ru': (value, _isUI) => {
    return value.replace(/([\u0400-\u04FF]+)/g, '<span class="ru-spacing-fix">$1</span>');
  }
};

let globalConfig = {
  lang: 'en',
  name: '',
  chatTipIndex: -1,
  tabToChat: true,
  disableFloodProtection: false,
  notifications: {
    all: true,
    screenPosition: 'bottomLeft'
  }
};

let config = {
  singlePlayer: false,
  disableChat: false,
  disableNametags: false,
  disablePlayerSounds: false,
  immersionMode: false,
  chatTabIndex: 0,
  playersTabIndex: 0,
  globalMessage: false,
  hideOwnGlobalMessageLocation: false,
  showGlobalMessageLocation: false,
  showPartyMemberLocation: true,
  lastEventLocations: null
};

let cache = {
  location: {},
  map: {}
};

let locationCache;
let mapCache;

let ynomojiConfig = {};

let connStatus;
let hasConnected = false;

// EXTERNAL
function onUpdateConnectionStatus(status) {
  const updateStatusText = function () {
    const connStatusIcon = document.getElementById('connStatusIcon');
    const connStatusText = document.getElementById('connStatusText');
    connStatusIcon.classList.toggle('connecting', status === 2);
    connStatusIcon.classList.toggle('connected', status === 1);
    connStatusIcon.classList.toggle('singlePlayer', status === 3);
    if (localizedMessages)
      connStatusText.innerHTML = getMassagedLabel(localizedMessages.connStatus[status]);
    connStatusText.classList.toggle('altText', !status);
  }; 
  if (connStatus !== undefined && (!status || status === 2))
    setTimeout(function () {
      if (connStatus === status)
        updateStatusText();
    }, 500);
  else
    updateStatusText();

  if (sessionId && connStatus === 3 && status !== 3)
    updateEventLocationList();

  connStatus = status;

  if (status === 1) {
    addOrUpdatePlayerListEntry(null, systemName, playerName, defaultUuid);
    fetchAndUpdatePlayerCount();
    checkEventLocations();
    if (!hasConnected) {
      addChatTip();
      hasConnected = true;
    }
    syncPrevLocation();
  } else
    clearPlayerLists();
}

function fetchAndUpdatePlayerInfo() {
  const cookieSessionId = getCookie('sessionId');
  const isLogin = cookieSessionId && cookieSessionId !== sessionId;
  const isLogout = !cookieSessionId && sessionId && cookieSessionId !== sessionId;
  if (isLogin || isLogout) {
    sessionId = isLogin ? cookieSessionId : null;
    const ptr = Module.allocate(Module.intArrayFromString(isLogin ? sessionId : ''), Module.ALLOC_NORMAL);
    Module._SetSessionToken(ptr);
    Module._free(ptr);
  }
  apiFetch('info')
    .then(response => response.json())
    .then(jsonResponse => {
      if (jsonResponse.uuid) {
        if (jsonResponse.name)
          playerName = jsonResponse.name;
        syncPlayerData(jsonResponse.uuid, jsonResponse.rank, !!sessionId, -1);
        if (isLogin) {
          trySetChatName(playerName);
          showAccountToastMessage('loggedIn', 'join', getPlayerName(playerData, true, true));
          if (eventPeriodCache)
            updateEventLocationList();
          else {
            apiFetch('eventLocations?command=period')
              .then(response => {
                if (!response.ok)
                  throw new Error(response.statusText);
                return response.json();
              })
              .then(eventPeriod => {
                if (eventPeriod.periodOrdinal < 0)
                  return;
                document.getElementById('eventControls').style.display = 'unset';
                eventPeriodCache = eventPeriod;
                updateEventLocationList();
              });
          }
          document.getElementById('content').classList.add('loggedIn');
        } else if (isLogout) {
          trySetChatName('');
          showAccountToastMessage('loggedOut', 'leave');
          document.getElementById('content').classList.remove('loggedIn');
        }
        if (document.querySelector('#chatboxTabParties.active'))
          updatePartyList(true);
        else
          fetchAndUpdateJoinedPartyId();
      } else if (isLogin) {
        setCookie('sessionId', '');
        fetchAndUpdatePlayerInfo();
      }
    })
    .catch(err => console.error(err));
}

let playerCount;

function fetchAndUpdatePlayerCount() {
  apiFetch('players')
    .then(response => response.text())
    .then(count => updatePlayerCount(count))
    .catch(err => console.error(err));
}

function updatePlayerCount(count) {
  if (isNaN(count))
    return;
  const playerCountLabel = document.getElementById('playerCountLabel');
  if (localizedMessages)
    playerCountLabel.innerHTML = getMassagedLabel(localizedMessages.playersOnline[count == 1 ? 'singular' : 'plural'].replace('{COUNT}', count), true);
  if (playerCount === undefined)
    document.getElementById('onlineInfo').classList.remove('hidden');
  playerCount = count;
}

function updateMapPlayerCount(count) {
  if (isNaN(count))
    return;
  const mapPlayerCountLabel = document.getElementById('mapPlayerCountLabel');
  if (localizedMessages)
    mapPlayerCountLabel.innerHTML = getMassagedLabel(localizedMessages.playersInMap[count == 1 ? 'singular' : 'plural'].replace('{COUNT}', count), true);
}

let playerName;
let systemName;

setSystemName(getDefaultUiTheme());
populateUiThemes();

const gameLogoUrl = `../images/logo_${gameId}.png`;
const gameLogoImg = new Image();
gameLogoImg.onload = function () {
  let width = gameLogoImg.width;
  let height = gameLogoImg.height;

  width *= 48 / height;
  height = 48;

  if (width > 180) {
    height *= 180 / width;
    width = 180;
  }
  
  const gameLogo = document.getElementById('gameLogo');
  gameLogo.setAttribute('style', `background-image: url('${gameLogoUrl}'); width: ${width}px; height: ${height}px;`);
  document.getElementById('gameLogoOverlay').setAttribute('style', `-webkit-mask-image: url('${gameLogoUrl}'); mask-image: url('${gameLogoUrl}'); mix-blend-mode: ${gameLogoBlendModeOverrides[gameId] || 'multiply'};`);
  gameLogo.classList.remove('hidden');
};
gameLogoImg.src = gameLogoUrl;

let cachedMapId = null;
let cachedPrevMapId = null;
let cachedLocations = null;
let cached2kkiLocations = null; // Used only by Yume 2kki
let cachedPrev2kkiLocations = null; // Used only by Yume 2kki
let ignoredMapIds = [];

// EXTERNAL
function onLoadMap(mapName) {
  let mapIdMatch = /^Map(\d{4})\.lmu$/.exec(mapName);
  if (mapIdMatch) {
    const mapId = mapIdMatch[1];

    if (mapId === cachedMapId || ignoredMapIds.indexOf(mapId) > -1)
      return;

    markMapUpdateInChat();
    
    const is2kki = gameId === '2kki';

    if (is2kki && (!localizedMapLocations || !localizedMapLocations.hasOwnProperty(mapId)))
      onLoad2kkiMap(mapId);
    else {
      if (localizedMapLocations) {
        if (!cachedMapId)
          document.getElementById('location').classList.remove('hidden');

        document.getElementById('locationText').innerHTML = getLocalizedMapLocationsHtml(mapId, cachedMapId, '<br>');
        onUpdateChatboxInfo();

        if (is2kki) {
          cachedPrev2kkiLocations = cached2kkiLocations;
          cached2kkiLocations = null;
          set2kkiExplorerLinks(null);
          set2kkiMaps([]);
        }
      }

      cachedPrevMapId = cachedMapId;
      cachedMapId = mapId;

      if (localizedMapLocations) {
        const locations = getMapLocationsArray(mapLocations, cachedMapId, cachedPrevMapId);
        if (!locations || !cachedLocations || JSON.stringify(locations) !== JSON.stringify(cachedLocations))
          addChatMapLocation();

        cachedLocations = locations;
      }
    }
  }
}

function syncPrevLocation() {
  const prevMapId = cachedPrevMapId || '0000';
  const prevLocationsStr = cachedPrev2kkiLocations?.length ? window.btoa(encodeURIComponent(cachedPrev2kkiLocations.map(l => l.title).join('|'))) : '';
  apiFetch(`ploc?prevMapId=${prevMapId}&prevLocations=${prevLocationsStr}`)
    .catch(err => console.error(err));
}

// EXTERNAL
function onReceiveInputFeedback(inputId) {
  if (inputId) {
    let buttonElement;
    let configKey;
    let isGlobal;
    switch (inputId) {
      case 1:
        buttonElement = document.getElementById('singlePlayerButton');
        configKey = 'singlePlayer';
        document.getElementById('layout').classList.toggle('singlePlayer');
        break;
      case 2:
        buttonElement = document.getElementById('nametagButton');
        configKey = 'disableNametags';
        break;
      case 3:
        buttonElement = document.getElementById('playerSoundsButton');
        configKey = 'disablePlayerSounds';
        break;
      case 4:
        buttonElement = document.getElementById('ownGlobalMessageLocationButton');
        configKey = 'hideOwnGlobalMessageLocation';
        break;
      case 5:
        buttonElement = document.getElementById('floodProtectionButton');
        configKey = 'disableFloodProtection';
        isGlobal = true;
        break;
    }
    if (configKey) {
      buttonElement.classList.toggle('toggled');
      if (isGlobal)
        globalConfig[configKey] = buttonElement.classList.contains('toggled');
      else
        config[configKey] = buttonElement.classList.contains('toggled');
      updateConfig(isGlobal ? globalConfig : config, isGlobal);
    }
  }
}

function preToggle(buttonElement) {
  buttonElement.classList.add('preToggled');
  const tryToggleTimer = setInterval(function () {
    if (buttonElement.classList.contains('toggled')) {
      buttonElement.classList.remove('preToggled');
      clearInterval(tryToggleTimer);
    } else
      buttonElement.click();
  }, 500);
}

{
  function calcTextareaHeight(value) {
    const numberOfLineBreaks = (value.match(/\n/g) || []).length;
    const newHeight = numberOfLineBreaks * 20 + 38;
    return newHeight;
  }

  const autoExpandTextareas = document.querySelectorAll('textarea.autoExpand');
  for (let textarea of autoExpandTextareas)
    textarea.addEventListener('keyup', function () { this.style.height = `${calcTextareaHeight(textarea.value)}px`; });
}

function openModal(modalId, theme, lastModalId, modalData) {
  const modalContainer = document.getElementById('modalContainer');
  modalContainer.classList.remove('hidden');

  if (lastModalId) {
    if (modalContainer.dataset.lastModalId) {
      modalContainer.dataset.lastModalId = `${modalContainer.dataset.lastModalId},${lastModalId}`;
      modalContainer.dataset.lastModalTheme = `${modalContainer.dataset.lastModalTheme},${theme || ''}`;
    } else {
      modalContainer.dataset.lastModalId = lastModalId;
      modalContainer.dataset.lastModalTheme = theme || '';
    }
  } else if (modalContainer.dataset.lastModalId) {
    const lastModalIdSeparatorIndex = modalContainer.dataset.lastModalId.lastIndexOf(',');
    if (lastModalIdSeparatorIndex === -1) {
      delete modalContainer.dataset.lastModalId;
      delete modalContainer.dataset.lastModalTheme;
    } else {
      modalContainer.dataset.lastModalId = modalContainer.dataset.lastModalId.slice(0, lastModalIdSeparatorIndex);
      modalContainer.dataset.lastModalTheme = modalContainer.dataset.lastModalTheme.slice(0, modalContainer.dataset.lastModalTheme.lastIndexOf(','));
    }
  }
  const activeModal = document.querySelector('.modal:not(.hidden)');
  if (activeModal && activeModal.id !== modalId)
    activeModal.classList.add('hidden');

  setModalUiTheme(modalId, theme || (config.uiTheme === 'auto' ? systemName : config.uiTheme));

  const modal = document.getElementById(modalId);

  if (modalData) {
    for (let k of Object.keys(modalData))
      modal.dataset[k] = modalData[k];
  }
  modal.classList.remove('hidden');
}

function closeModal() {
  const modalContainer = document.getElementById('modalContainer');
  if (!modalContainer.dataset.lastModalId)
    modalContainer.classList.add('hidden');
  const activeModal = document.querySelector('.modal:not(.hidden)');
  if (activeModal)
    activeModal.classList.add('hidden');
  if (modalContainer.dataset.lastModalId) {
    const lastModalIdSeparatorIndex = modalContainer.dataset.lastModalId.lastIndexOf(',');
    if (lastModalIdSeparatorIndex === -1)
      openModal(modalContainer.dataset.lastModalId, modalContainer.dataset.lastModalTheme);
    else {
      const lastModalThemeSeparatorIndex = modalContainer.dataset.lastModalTheme.lastIndexOf(',');
      openModal(modalContainer.dataset.lastModalId.slice(lastModalIdSeparatorIndex + 1), modalContainer.dataset.lastModalTheme.slice(lastModalThemeSeparatorIndex + 1));
    }
  }
};
{
  const modalCloseButtons = document.querySelectorAll('.modalClose');
  for (let button of modalCloseButtons)
    button.onclick = closeModal;
  document.querySelector('.modalOverlay').onclick = closeModal;
}

document.getElementById('enterNameForm').onsubmit = function () {
  setName(document.getElementById('nameInput').value);
};

{
  const chatInput = document.getElementById('chatInput');
  chatInput.oninput = function () {
    const ynomojiPattern = /:([a-z0-9\_\-]+(?:\:|$)|$)/gi;
    const ynomojiContainer = document.getElementById('ynomojiContainer');
    let currentMatch;
    let match;
    while (currentMatch = ynomojiPattern.exec(this.value.slice(0, this.selectionEnd)))
      match = currentMatch;
    if (match && !match[1].endsWith(':')) {
      const ynomojis = document.getElementsByClassName('ynomojiButton');
      let hasMatch = false;
      for (let ynomoji of ynomojis) {
        const visible = ynomoji.dataset.ynomojiId.startsWith(match[1]);
        ynomoji.classList.toggle('hidden', !visible);
        hasMatch |= visible;
      }
      if (match[1])
        ynomojiContainer.classList.toggle('hidden', !hasMatch);
      else {
        const currentInputValue = this.value;
        setTimeout(() => {
          if (chatInput.value === currentInputValue)
            ynomojiContainer.classList.remove('hidden');
        }, 1000);
      }
    } else
      ynomojiContainer.classList.add('hidden');
  };

  chatInput.onfocus = function () { this.oninput(); };
  document.getElementById('chatboxContainer').onmouseleave = function () { document.getElementById('ynomojiContainer').classList.add('hidden'); };
}

document.getElementById('singlePlayerButton').onclick = function () {
  if (Module.INITIALIZED)
    Module._ToggleSinglePlayer();
};

document.getElementById('chatButton').onclick = function () {
  this.classList.toggle('toggled');
  document.getElementById('layout').classList.toggle('hideChat');
  onResize();
  config.disableChat = this.classList.contains('toggled');
  updateConfig(config);
};

document.getElementById('immersionModeButton').onclick = function () {
  this.classList.toggle('toggled');
  const toggled = this.classList.contains('toggled');
  if (toggled) {
    document.querySelector('.chatboxTab[data-tab-section="chat"]').click();
    document.getElementById('chatTabMap').click();
  }
  document.getElementById('layout').classList.toggle('immersionMode', toggled);
  onResize();
  config.immersionMode = toggled;
  updateConfig(config);
};

document.getElementById('globalMessageButton').onclick = function () {
  this.classList.toggle('toggled');
  const chatInput = document.getElementById('chatInput');
  const toggled = this.classList.contains('toggled');
  if (toggled)
    chatInput.dataset.global = true;
  else
    delete chatInput.dataset.global;
  chatInput.disabled = toggled && document.getElementById('chatInputContainer').classList.contains('globalCooldown');
  config.globalMessage = toggled;
  updateConfig(config);
};

document.getElementById('ownGlobalMessageLocationButton').onclick = function () {
  if (Module.INITIALIZED)
    Module._ToggleGlobalMessageLocation();
};

{
  config.uiTheme = 'Default';

  document.getElementById('uiThemeButton').onclick = () => openModal('uiThemesModal');

  const uiThemes = document.querySelectorAll('#uiThemesModal .uiTheme');

  for (uiTheme of uiThemes)
    uiTheme.onclick = onSelectUiTheme;
}

config.fontStyle = 0;

document.querySelector('.fontStyle').onchange = function () {
  setFontStyle(parseInt(this.value));
};

document.getElementById('clearChatButton').onclick = function () {
  const chatbox = document.getElementById('chatbox');
  const messagesElement = document.getElementById('messages');
  const mapFiltered = chatbox.classList.contains('mapChat');
  const globalFiltered = chatbox.classList.contains('globalChat');
  const partyFiltered = chatbox.classList.contains('partyChat');
  if (mapFiltered || globalFiltered || partyFiltered) {
    const messages = messagesElement.querySelectorAll(`.messageContainer${globalFiltered ? '.global' : partyFiltered ? '.party' : ':not(.global):not(.party)'}`);
    for (let message of messages)
      message.remove();
  } else {
    messagesElement.innerHTML = '';

    const unreadChatTab = document.querySelector('.chatTab.unread');
    if (unreadChatTab)
      unreadChatTab.classList.remove('unread');
  }
};

document.getElementById('settingsButton').onclick = () => openModal('settingsModal');

document.getElementById('lang').onchange = function () {
  setLang(this.value);
};

document.getElementById('nametagButton').onclick = () => {
  if (Module.INITIALIZED)
    Module._ToggleNametags();
};

document.getElementById('playerSoundsButton').onclick = () => {
  if (Module.INITIALIZED)
    Module._TogglePlayerSounds();
};

document.getElementById('tabToChatButton').onclick = function () {
  this.classList.toggle('toggled');
  globalConfig.tabToChat = !this.classList.contains('toggled');
  updateConfig(globalConfig, true);
};

document.getElementById('floodProtectionButton').onclick = () => {
  if (Module.INITIALIZED)
    Module._ToggleFloodDefender();
};

initNotificationsConfigAndControls();

initAccountControls();
initSaveDataControls();
initPartyControls();
initEventControls();

document.getElementById('nexusButton').onclick = () => window.location = '../';

if (gameId === '2kki') {
  document.getElementById('2kkiVersion').innerText = document.querySelector('meta[name="2kkiVersion"]').content || '?';
  // Yume 2kki Explorer doesn't support mobile
  if (hasTouchscreen)
    document.getElementById('explorerControls').remove();
}

Array.from(document.querySelectorAll('.playerCountLabel')).forEach(pc => {
  pc.onclick = function () {
    const playerCountLabels = document.querySelectorAll('.playerCountLabel');
    for (let pcl of playerCountLabels)
      pcl.classList.toggle('hidden');
    onUpdateChatboxInfo();
  };
});

let activeChatboxTabSection = 'chat';

function onClickChatboxTab() {
  if (this.dataset.tabSection !== activeChatboxTabSection) {
    activeChatboxTabSection = this.dataset.tabSection;
    if (activeChatboxTabSection === 'chat')
      document.getElementById("unreadMessageCountContainer").classList.add('hidden');
    else if (activeChatboxTabSection === 'parties') {
      updatePartyList();
      if (updatePartyListTimer)
        clearInterval(updatePartyListTimer);
      updatePartyListTimer = setInterval(() => {
        if (skipPartyListUpdate)
          skipPartyListUpdate = false;
        else if (document.getElementById('chatboxTabParties').classList.contains('active'))
          updatePartyList();
        else {
          clearInterval(updatePartyListTimer);
          updatePartyListTimer = null;
        }
      }, 10000);
    }
    for (let tab of document.getElementsByClassName('chatboxTab'))
      tab.classList.toggle('active', tab === this);
    for (let tabSection of document.getElementsByClassName('chatboxTabSection'))
      tabSection.classList.toggle('hidden', tabSection.id !== activeChatboxTabSection);
  }
}

for (let tab of document.getElementsByClassName('chatboxTab'))
  tab.onclick = onClickChatboxTab;

function setChatTab(tab, saveConfig) {
  const chatTabs = document.getElementById('chatTabs');
  const tabIndex = Array.prototype.indexOf.call(chatTabs.children, tab);
  const activeTabIndex = Array.prototype.indexOf.call(chatTabs.children, chatTabs.querySelector('.active'));
  if (tabIndex !== activeTabIndex) {
    const chatbox = document.getElementById('chatbox');
    const messages = document.getElementById('messages');
    const chatInput = document.getElementById('chatInput');
    for (let chatTab of document.getElementsByClassName('chatTab')) {
      const active = chatTab === tab;
      chatTab.classList.toggle('active', active);
      if (active || !tabIndex)
        chatTab.classList.remove('unread');
    }
    const global = (!tabIndex && config.globalMessage) || tabIndex === 2;
    if (global)
      chatInput.dataset.global = true;
    else
      delete chatInput.dataset.global;
    chatInput.disabled = global && document.getElementById('chatInputContainer').classList.contains('globalCooldown');
    chatbox.classList.toggle('allChat', !tabIndex);
    chatbox.classList.toggle('mapChat', tabIndex === 1);
    chatbox.classList.toggle('globalChat', tabIndex === 2);
    chatbox.classList.toggle('partyChat', tabIndex === 3);
    messages.scrollTop = messages.scrollHeight;

    if (saveConfig) {
      config.chatTabIndex = tabIndex;
      updateConfig(config);
    }
  }
}

for (let chatTab of document.getElementsByClassName('chatTab'))
  chatTab.onclick = function () { setChatTab(this, true); };

function setPlayersTab(tab, saveConfig) {
  const playersTabs = document.getElementById('playersTabs');
  const tabIndex = Array.prototype.indexOf.call(playersTabs.children, tab);
  const activeTabIndex = Array.prototype.indexOf.call(playersTabs.children, playersTabs.querySelector('.active'));
  if (tabIndex !== activeTabIndex) {
    for (let playersTab of document.getElementsByClassName('playersTab')) {
      const active = playersTab === tab;
      playersTab.classList.toggle('active', active);
      if (active || !tabIndex)
        playersTab.classList.remove('unread');
    }

    document.getElementById('chatbox').classList.toggle('partyPlayers', tabIndex === 1);

    if (saveConfig) {
      config.playersTabIndex = tabIndex;
      updateConfig(config);
    }

    if (tabIndex === 1 && joinedPartyId)
      updateJoinedParty(true);
  }
}

for (let tab of document.getElementsByClassName('playersTab'))
  tab.onclick = function () { setPlayersTab(this, true); };

let ignoreSizeChanged = false;

function onResize() {
  const content = document.getElementById('content');
  const layout = document.getElementById('layout');

  const downscale = window.innerWidth < 704 || window.innerHeight < 577;
  const downscale2 = window.innerWidth < 544 || window.innerHeight < 457;

  content.classList.toggle('noSideBorders', window.innerWidth < 384);

  onUpdateChatboxInfo();

  document.documentElement.style.setProperty('--content-height', `${document.getElementById('bottom').offsetTop}px`);

  if (window.innerWidth < window.innerHeight) {
    content.classList.toggle('downscale', downscale);
    content.classList.toggle('downscale2', downscale2);
    layout.classList.toggle('overflow', isOverflow(downscale2 ? 0.5 : downscale ? 0.75 : 1));
  } else {
    layout.classList.add('overflow');
    const overflow = isOverflow();
    if (overflow !== isOverflow(0.75)) {
      content.classList.toggle('downscale', downscale || overflow);
      content.classList.remove('downscale2');
      layout.classList.toggle('overflow', !overflow);
    } else if (overflow !== isOverflow(0.5)) {
      content.classList.toggle('downscale', downscale || overflow);
      content.classList.toggle('downscale2', downscale2 || overflow);
      layout.classList.toggle('overflow', !overflow);
    } else {
      content.classList.toggle('downscale', downscale);
      content.classList.toggle('downscale2', downscale2);
      layout.classList.toggle('overflow', overflow);
    }
  }

  updateCanvasFullscreenSize();
}

function updateYnomojiContainerPos(isScrollUpdate) {
  const chatInput = document.getElementById('chatInput');
  const chatboxContainer = document.getElementById('chatboxContainer');
  const ynomojiContainer = document.getElementById('ynomojiContainer');
  const isFullscreen = document.fullscreenElement;
  const isWrapped =  window.getComputedStyle(document.getElementById('layout')).flexWrap === 'wrap';
  const isDownscale2 = document.getElementById('content').classList.contains('downscale2');
  const isFullscreenSide = isFullscreen && (window.innerWidth > 1050 || window.innerHeight < 595);
  ynomojiContainer.style.bottom = hasTouchscreen && ((isWrapped && isDownscale2) || isFullscreenSide)
    ? `calc((100% - ${chatInput.offsetTop}px) + max(${isFullscreen ? 6 : 1}rem + 2 * var(--controls-size) - (100% - ${chatInput.offsetTop}px - ${isFullscreen && !isFullscreenSide ? `(${chatboxContainer.style.marginTop} - 24px)` : '0px'}) - var(--content-scroll), 0px))`
    : `calc(100% - ${chatInput.offsetTop}px)`;
  ynomojiContainer.style.maxHeight = hasTouchscreen && ((isWrapped && isDownscale2) || isFullscreenSide)
    ? `calc(${document.getElementById('messages').offsetHeight - 16}px - max(${isFullscreen ? 6 : 1}rem + 2 * var(--controls-size) - (100% - ${chatInput.offsetTop}px - ${isFullscreen && !isFullscreenSide ? `(${chatboxContainer.style.marginTop} - 24px)` : '0px'}) - var(--content-scroll), 0px))`
    : `${document.getElementById('messages').offsetHeight - 16}px`;
  if (!isScrollUpdate) {
    ynomojiContainer.style.width = hasTouchscreen && isWrapped && !isDownscale2
      ? `calc(${chatInput.offsetWidth - 24} - 4 * var(--controls-size))`
      : `${chatInput.offsetWidth - 24}px`;
    ynomojiContainer.style.margin = hasTouchscreen && isWrapped && !isDownscale2
      ? `0 calc(2 * var(--controls-size) + ${document.getElementById('layout').offsetLeft * 2 + 4}px) 9px calc(2 * var(--controls-size) - ${document.getElementById('layout').offsetLeft * 2 - 4}px)`
      : '';
  }
}

function onUpdateChatboxInfo() {
  const layout = document.getElementById('layout');

  const chatboxContainer = document.getElementById('chatboxContainer');
  const chatboxInfo = document.getElementById('chatboxInfo');
  const chatboxTabs = document.getElementsByClassName('chatboxTab');

  const backgroundSize = chatboxContainer.classList.contains('fullBg') ? window.getComputedStyle(chatboxContainer).backgroundSize : null;

  for (let tab of chatboxTabs) {
    tab.style.backgroundSize = backgroundSize;
    tab.style.backgroundPositionX = `${-8 + tab.parentElement.offsetLeft - tab.getBoundingClientRect().left}px`;
    tab.style.backgroundPositionY = `${chatboxContainer.offsetTop - tab.parentElement.getBoundingClientRect().top}px`;
  }

  const messages = document.getElementById('messages');
  const partyPlayerList = document.getElementById('partyPlayerList');
  messages.style.backgroundPositionY = partyPlayerList.style.backgroundPositionY = `${chatboxContainer.offsetTop - partyPlayerList.getBoundingClientRect().top}px`;

  if (!layout.classList.contains('immersionMode') && !document.fullscreenElement && window.getComputedStyle(layout).flexWrap === 'wrap') {
    const lastTab = chatboxTabs[chatboxTabs.length - 1];
    const offsetLeft = `${(lastTab.offsetLeft + lastTab.offsetWidth) - 24}px`;
    chatboxInfo.style.marginLeft = offsetLeft;
    chatboxInfo.style.marginBottom = '-32px';
    if (chatboxInfo.offsetHeight >= 72)
      chatboxInfo.setAttribute('style', '');
  } else
    chatboxInfo.setAttribute('style', '');
}

function isOverflow(scale) {
  return window.innerWidth < 984 && window.innerHeight <= 594 && (window.innerWidth <= 704 || document.getElementById('gameContainer').offsetWidth < (640 * (scale || 1)) + (document.getElementById('layout').classList.contains('overflow') ? 288 : 0));
}

function updateCanvasFullscreenSize() {
  const contentElement = document.getElementById('content');
  const layoutElement = document.getElementById('layout');
  const canvasElement = document.getElementById('canvas');
  const canvasContainerElement = document.getElementById('canvasContainer');
  const chatboxContainerElement = document.getElementById('chatboxContainer');
  const messages = document.getElementById('messages');

  let canvasContainerPaddingRight = null;
  let canvasContainerMarginTop = null;
  let chatboxContainerMarginTop = null;
  let chatboxHeight = null;
  let chatboxOverlap = false;
  let leftControlsMaxHeight = null;
  
  if (document.fullscreenElement) {
    const showChat = !layoutElement.classList.contains('hideChat');
    let scaleX = window.innerWidth / canvasElement.offsetWidth;
    let scaleY = window.innerHeight / canvasElement.offsetHeight;
    const scaleFraction = contentElement.classList.contains('downscale') ? 0.25 : 0.5;
    scaleX -= scaleX % scaleFraction;
    scaleY -= scaleY % scaleFraction;
    const scale = Math.max(Math.min(scaleX, scaleY), 0.5);
    canvasElement.style.transform = `scale(${scale})`;

    if (window.innerWidth > 1050 || window.innerHeight < 595) {
      const chatboxContainerWidth = chatboxContainerElement.offsetWidth - 24;
      chatboxContainerMarginTop = '24px';
      if (chatboxContainerWidth + 48 <= window.innerWidth - (canvasElement.offsetWidth * scale)) {
        if (showChat) {
          canvasContainerPaddingRight = `${chatboxContainerWidth}px`;
          leftControlsMaxHeight = `${canvasElement.offsetHeight * scale}px`;
        }
      } else
        chatboxOverlap = true;
    } else {
      const canvasScaledHeight = canvasElement.offsetHeight * scale;
      const unusedHeight = window.innerHeight - (canvasScaledHeight + 32);
      if (unusedHeight >= 376 && showChat) {
        canvasContainerMarginTop = `-${(window.innerHeight - canvasScaledHeight) / 2}px`
        chatboxContainerMarginTop = `${(window.innerHeight - unusedHeight) - 40}px`;
        chatboxHeight = `${unusedHeight}px`;
        leftControlsMaxHeight = `${canvasScaledHeight}px`;
      } else {
        chatboxContainerMarginTop = '24px';
        if (showChat)
          chatboxOverlap = true;
      }
    }
  } else {
    canvasElement.style.transform = null;
    canvasContainer.style.paddingRight = null;
    leftControlsMaxHeight = `${canvasElement.offsetHeight}px`;
  }

  canvasContainerElement.style.paddingRight = canvasContainerPaddingRight;
  canvasContainerElement.style.marginTop = canvasContainerMarginTop;
  chatboxContainerElement.style.marginTop = chatboxContainerMarginTop;
  layoutElement.classList.toggle('chatboxOverlap', chatboxOverlap);
  document.getElementById('chatbox').style.height = chatboxHeight;
  document.getElementById('leftControls').style.maxHeight = leftControlsMaxHeight;

  messages.scrollTop = messages.scrollHeight;

  updateYnomojiContainerPos();
}

window.onresize = function () { setTimeout(onResize, 0); };

document.addEventListener('fullscreenchange', updateCanvasFullscreenSize);

document.getElementById('content').addEventListener('scroll', function () {
  document.documentElement.style.setProperty('--content-scroll', `${this.scrollTop}px`);
  if (hasTouchscreen)
    updateYnomojiContainerPos(true);
});

function toggleControls(show) {
  document.getElementById('controls').classList.toggle('fshidden', !show);
}

let fullscreenControlsTimer;

function setFullscreenControlsHideTimer() {
  if (fullscreenControlsTimer)
    clearTimeout(fullscreenControlsTimer);
  fullscreenControlsTimer = setTimeout(function () {
    if (!document.querySelector("#controls button:hover"))
      toggleControls(false);
    fullscreenControlsTimer = null;
  }, 5000);
}

document.onmousemove = function () {
  if (document.fullscreenElement) {
    toggleControls(true);
    setFullscreenControlsHideTimer();
  }
};

window.onbeforeunload = function () {
  return localizedMessages.leavePage;
};

function setLang(lang, isInit) {
  globalConfig.lang = lang;
  if (isInit && localizedGameIds.indexOf(gameId) > -1)
    Module.EASYRPG_LANGUAGE = (gameDefaultLangs.hasOwnProperty(gameId) ? gameDefaultLangs[gameId] !== lang : lang !== 'en') ? lang : 'default';
  initLocalization(isInit);
  if (!isInit)
    updateConfig(globalConfig, true);
}

function setName(name, isInit) {
  globalConfig.name = name;
  if (!isInit)
    updateConfig(globalConfig, true);
}

function onSelectUiTheme(e) {
  const modalContainer = document.getElementById('modalContainer');
  if (!modalContainer.dataset.lastModalId?.endsWith('createPartyModal'))
    setUiTheme(e.target.dataset.uiTheme);
  else
    setPartyTheme(e.target.dataset.uiTheme);
  setModalUiTheme(null, e.target.dataset.uiTheme === 'auto' ? systemName : e.target.dataset.uiTheme, true);
}

function initLocalization(isInitial) {
  document.getElementsByTagName('html')[0].lang = globalConfig.lang;
  fetch(`lang/${globalConfig.lang}.json`)
    .then(response => response.json())
    .then(function (jsonResponse) {
      const version = jsonResponse.version[gameId];
      if (version) {
        const versionElement = document.querySelector('.version');
        const versionMeta = document.querySelector(`meta[name="${gameId}Version"]`);
        if (versionElement && versionMeta) {
          const substituteKeys = Object.keys(version.substitutes);
          let versionLabel = version.label.replace('{VERSION}', versionMeta.content || '?');
          for (let sk of substituteKeys)
            versionLabel = versionLabel.replace(sk, version.substitutes[sk]);
          versionElement.innerHTML = getMassagedLabel(versionLabel);
        }
      }

      massageLabels(jsonResponse.ui);

      localizedMessages = jsonResponse.messages;
      
      if (isInitial)
        onUpdateConnectionStatus(0);
      else {
        if (connStatus !== undefined)
          onUpdateConnectionStatus(connStatus);
        if (playerCount !== undefined)
          updatePlayerCount(playerCount);
      }

      if (isInitial)
        initLocations(globalConfig.lang);
      else if (localizedMapLocations)
        initLocalizedMapLocations(globalConfig.lang);

      if (eventPeriodCache)
        updateEventLocationList();

      const translationComplete = jsonResponse.translationComplete === '1';
      const translationInstruction = document.getElementById('translationInstruction');
      translationInstruction.classList.toggle('hidden', translationComplete);
      if (!translationComplete)
        document.getElementById('translationLink').href = `https://github.com/ynoproject/forest-orb/edit/master/lang/${globalConfig.lang}.json`;

      if (isInitial) {
        const languages = document.getElementById('lang').children;
        for (let langOpt of languages) {
          const lang = langOpt.value;
          if (gameDefaultLangs.hasOwnProperty(gameId) ? gameDefaultLangs[gameId] !== lang : lang !== 'en')
            fetch(`../data/${gameId}/Language/${lang}/meta.ini`).then(response => {
              if (!response.ok && response.status === 404) {
                langOpt.innerText += '*';
                langOpt.dataset.noGameLoc = true;
                if (lang === globalConfig.lang)
                  document.getElementById('noGameLocInstruction').classList.remove('hidden');
              }
            });
        }
      } else {
        const noGameLocInstruction = document.getElementById('noGameLocInstruction');
        noGameLocInstruction.classList.toggle('hidden', !document.querySelector(`#lang option[value='${globalConfig.lang}']`).dataset.noGameLoc);
      }

      const resourcesJson = {};
      resourcesJson[globalConfig.lang] = { translation: jsonResponse.ui };
      i18next.init({
        lng: globalConfig.lang,
        resources: resourcesJson,
        preventValueFromContent: false
      }, function (err) {
        if (err)
          console.error(err);
        locI18next.init(i18next)('[data-i18n]');
      });
    });
}

function initLocations(lang) {
  fetch(`locations/${gameId}/config.json`)
    .then(response => {
        if (!response.ok)
          throw new Error(response.statusText);
        return response.json();
    })
    .then(jsonResponse => {
        ignoredMapIds = jsonResponse.ignoredMapIds || [];
        locationUrlRoot = jsonResponse.urlRoot;
        localizedLocationUrlRoot = locationUrlRoot;
        mapLocations = jsonResponse.mapLocations || null;
        if (mapLocations && !Object.keys(mapLocations).length)
          mapLocations = null;
        if (mapLocations) {
          massageMapLocations(mapLocations, jsonResponse.locationUrlTitles || null);
          if (lang === 'en')
            localizedMapLocations = mapLocations;
          else
            initLocalizedMapLocations(lang);
        }
    })
    .catch(err => {
      ignoredMapIds = [];
      localizedMapLocations = null;
      console.error(err);
    });
}

function initLocalizedMapLocations(lang) {
  const fileName = lang === 'en' ? 'config' : lang;
  fetch(`locations/${gameId}/${fileName}.json`)
    .then(response => {
      if (!response.ok) {
        localizedMapLocations = mapLocations;
        return null; // Assume map location localizations for this language don't exist
      }
      return response.json();
  })
  .then(jsonResponse => {
      if (!jsonResponse)
        return;
      localizedLocationUrlRoot = jsonResponse.urlRoot;
      localizedMapLocations = {};
      const langMapLocations = jsonResponse.mapLocations;
      massageMapLocations(langMapLocations, jsonResponse.locationUrlTitles || null);
      Object.keys(mapLocations).forEach(function (mapId) {
        const mapLocation = langMapLocations[mapId];
        if (mapLocation)
          localizedMapLocations[mapId] = mapLocation;
        else
          localizedMapLocations[mapId] = mapLocations[mapId];
      });
  })
  .catch(_err => { }); // Assume map location localizations for this language don't exist
}

function getMapLocationsArray(mapLocations, mapId, prevMapId) {
  if (mapLocations.hasOwnProperty(mapId)) {
    const locations = mapLocations[mapId];
    if (locations.hasOwnProperty('title')) // Text location
      return [ locations ];
    if (Array.isArray(locations)) // Multiple locations
      return locations;
    if (locations.hasOwnProperty(prevMapId)) {// Previous map ID matches a key
      if (Array.isArray(locations[prevMapId]))
        return locations[prevMapId];
      return [ locations[prevMapId] ];
    }
    if (locations.hasOwnProperty('else')) { // Else case
      if (locations.else.hasOwnProperty('title'))
        return [ locations.else ];
      if (Array.isArray(locations.else))
        return locations.else;
    }
  }
}

function getLocalizedMapLocations(mapId, prevMapId, separator) {
  if (localizedMapLocations?.hasOwnProperty(mapId)) {
    const localizedLocations = localizedMapLocations[mapId];
    const locations = mapLocations[mapId];
    if (localizedLocations.hasOwnProperty('title')) // Text location
      return getLocalizedLocation(localizedLocations, locations);
    if (Array.isArray(localizedLocations)) // Multiple locations
      return localizedLocations.map((l, i) => getLocalizedLocation(l, locations[i])).join(separator);
    if (localizedLocations.hasOwnProperty(prevMapId)) { // Previous map ID matches a key
      if (Array.isArray(localizedLocations[prevMapId]))
        return localizedLocations[prevMapId].map((l, i) => getLocalizedLocation(l, locations[prevMapId][i])).join(separator);
      return getLocalizedLocation(localizedLocations[prevMapId], locations[prevMapId]);
    }
    if (localizedLocations.hasOwnProperty('else')) { // Else case
      if (localizedLocations.else.hasOwnProperty('title'))
        return getLocalizedLocation(localizedLocations.else, locations.else);
      if (Array.isArray(localizedLocations.else))
        return localizedLocations.else.map((l, i) => getLocalizedLocation(l, locations.else[i])).join(separator);
    }
  }
  
  return localizedMessages.location.unknownLocation;
}

function getLocalizedMapLocationsHtml(mapId, prevMapId, separator) {
  if (localizedMapLocations?.hasOwnProperty(mapId)) {
    const localizedLocations = localizedMapLocations[mapId];
    const locations = mapLocations[mapId];
    let locationsHtml;
    if (localizedLocations.hasOwnProperty('title')) // Text location
      locationsHtml = getLocalizedLocation(localizedLocations, locations, true);
    else if (Array.isArray(localizedLocations)) // Multiple locations
      locationsHtml = localizedLocations.map((l, i) => getLocalizedLocation(l, locations[i], true)).join(separator);
    else if (localizedLocations.hasOwnProperty(prevMapId)) { // Previous map ID matches a key
      if (Array.isArray(localizedLocations[prevMapId]))
        locationsHtml = localizedLocations[prevMapId].map((l, i) => getLocalizedLocation(l, locations[prevMapId][i], true)).join(separator);
      else
        locationsHtml = getLocalizedLocation(localizedLocations[prevMapId], locations[prevMapId], true);
    } else if (localizedLocations.hasOwnProperty('else')) {  // Else case
      if (localizedLocations.else.hasOwnProperty('title'))
        locationsHtml = getLocalizedLocation(localizedLocations.else, locations.else, true);
      else if (Array.isArray(localizedLocations.else))
        locationsHtml = localizedLocations.else.map((l, i) => getLocalizedLocation(l, locations.else[i], true)).join(separator);
    }

    if (locationsHtml)
      return locationsHtml;
  }
  
  return getInfoLabel(getMassagedLabel(localizedMessages.location.unknownLocation));
}

function massageMapLocations(mapLocations, locationUrlTitles) {
  if (Array.isArray(mapLocations)) {
    for (let l = 0; l < mapLocations.length; l++) {
      const mapLocation = mapLocations[l];
      if (typeof mapLocation === 'string') {
        mapLocations[l] = { title: mapLocation };
        if (locationUrlTitles?.hasOwnProperty(mapLocation))
          mapLocations[l].urlTitle = locationUrlTitles[mapLocation];
      }
    }
  } else {
    if (mapLocations.hasOwnProperty('title')) {
      if (locationUrlTitles?.hasOwnProperty(mapLocations.title))
        mapLocations.urlTitle = locationUrlTitles[mapLocations.title];
      return;
    }
    for (let mapId of Object.keys(mapLocations)) {
      const mapLocation = mapLocations[mapId];
      if (typeof mapLocation === 'string') {
        mapLocations[mapId] = { title: mapLocation };
        if (locationUrlTitles?.hasOwnProperty(mapLocation))
          mapLocations[mapId].urlTitle = locationUrlTitles[mapLocation];
      } else
        massageMapLocations(mapLocation);
    }
  }
}

function getLocalizedLocation(location, locationEn, asHtml) {
  let template = getMassagedLabel(localizedMessages.location.template);
  let ret;
  let locationValue;

  if (asHtml) {
    template = template.replace(/(?:})([^{]+)/g, '}<span class="infoLabel">$1</span>');
    if (localizedLocationUrlRoot && location.urlTitle !== null)
      locationValue = `<a href="${localizedLocationUrlRoot}${location.urlTitle || location.title}" target="_blank">${location.title}</a>`;
    else if (locationUrlRoot && localizedLocationUrlRoot !== null && locationEn.urlTitle !== null)
      locationValue = `<a href="${locationUrlRoot}${locationEn.urlTitle || locationEn.title}" target="_blank">${location.title}</a>`;
    else
      locationValue = getInfoLabel(location.title);
  } else
    locationValue = location.title;

  ret = template.replace('{LOCATION}', locationValue);
  
  if (template.indexOf('{LOCATION_EN}') > -1) {
    let locationValueEn;
    if (asHtml) {
      if (locationUrlRoot && locationEn.urlTitle !== null)
        locationValueEn = `<a href="${locationUrlRoot}${locationEn.urlTitle || locationEn.title}" target="_blank">${locationEn.title}</a>`;
      else
        locationValueEn = getInfoLabel(locationEn.title);
    } else
      locationValueEn = locationEn.title;
    
    ret = locationValue !== locationValueEn
      ? ret.replace('{LOCATION_EN}', locationValueEn)
      : locationValue; // Just use location value alone if values match
  }

  return ret;
}

function massageLabels(data) {
  if (langLabelMassageFunctions.hasOwnProperty(globalConfig.lang) && data) {
    Object.keys(data).forEach(function (key) {
      if (key === 'tooltips')
        return;
      const value = data[key];
      if (value) {
        switch (typeof value) {
          case 'object':
            massageLabels(value);
            break;
          case 'string':
            data[key] = getMassagedLabel(value, true);
            break;
        }
      }
    });
  }
}

function getMassagedLabel(label, isUI) {
  if (langLabelMassageFunctions.hasOwnProperty(globalConfig.lang) && label)
    return langLabelMassageFunctions[globalConfig.lang](label, isUI);
  return label;
}

function getInfoLabel(label) {
  return `<span class="infoLabel">${label}</span>`;
}

function fetchAndPopulateYnomojiConfig() {
  fetch('ynomoji.json')
    .then(response => response.json())
    .then(jsonResponse => {
      ynomojiConfig = jsonResponse;
      const ynomojiContainer = document.getElementById('ynomojiContainer');
      Object.keys(ynomojiConfig).forEach(ynomojiId => {
        const ynomojiButton = document.createElement('a');
        ynomojiButton.href = 'javascript:void(0)';
        ynomojiButton.dataset.ynomojiId = ynomojiId;
        ynomojiButton.classList.add('ynomojiButton');
        
        const ynomoji = document.createElement('img');
        ynomoji.src = `${ynomojiUrlPrefix}${ynomojiConfig[ynomojiId]}`;
        ynomoji.title = `:${ynomojiId}:`;
        ynomoji.classList.add('ynomoji');
        ynomoji.onclick = () => insertYnomoji(ynomojiId);

        ynomojiButton.appendChild(ynomoji);
        ynomojiContainer.appendChild(ynomojiButton);
      });
    });
}

function insertYnomoji(ynomojiId) {
  const chatInput = document.getElementById('chatInput');
  const ynomojiMatch = /:([a-z0-9\_\-]+)?$/i.exec(chatInput.value.slice(0, chatInput.selectionEnd));
  if (ynomojiMatch)
    chatInput.value = `${chatInput.value.slice(0, ynomojiMatch.index)}:${ynomojiId}:${chatInput.value.slice(chatInput.selectionEnd)}`;
  else
    chatInput.value += `:${ynomojiId}:`;
  chatInput.oninput();
}

function loadOrInitCache() {
  const request = indexedDB.open(gameId);

  request.onupgradeneeded = event => {
    const db = event.target.result;
    db.createObjectStore('CACHE', {});

    locationCache = {};
    mapCache = {};
  };

  request.onsuccess = function (_e) {
    const db = request.result;
    const transaction = db.transaction(['CACHE'], 'readwrite');
    const cacheKeys = Object.keys(cache);
    for (let k of cacheKeys) {
      const valueReq = transaction.objectStore('CACHE').get(k.toUpperCase());
      valueReq.onsuccess = valueReqRes => {
        const value = valueReqRes.target.result;
        switch (k) {
          case 'location':
            locationCache = Object.assign({}, value);
            break;
          case 'map':
            mapCache = Object.assign({}, value);
            break;
        }
        if (value)
          cache[k] = value;
      };
    }
  };
}

function updateCache(cacheType) {
  if (cache.hasOwnProperty(cacheType)) {
    const request = indexedDB.open(gameId);

    request.onsuccess = function (_e) {
      const db = request.result;
      const transaction = db.transaction(['CACHE'], 'readwrite');
      transaction.objectStore('CACHE').put(cache[cacheType], cacheType.toUpperCase());
    };
  }
}

onResize();

loadOrInitConfig(globalConfig, true);
loadOrInitConfig(config);
loadOrInitCache();

fetchAndUpdatePlayerCount();
setInterval(fetchAndUpdatePlayerCount, 15000);

initDefaultSprites();
fetchAndPopulateYnomojiConfig();

if (!loadedUiTheme)
  setUiTheme('auto', true);
if (!loadedFontStyle)
  setFontStyle(0, true);
if (!loadedLang) {
  const browserLang = navigator.language.indexOf('-') === -1 ? navigator.language : navigator.language.slice(0, navigator.language.indexOf('-'));
  setLang(Array.from(document.getElementById('lang').children).map(e => e.value).indexOf(browserLang) > -1 ? browserLang : 'en', true);
}