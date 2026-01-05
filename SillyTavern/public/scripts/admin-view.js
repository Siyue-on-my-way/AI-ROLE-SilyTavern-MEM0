import { eventSource, event_types } from '../script.js';

// Configuration for Admin Tabs and their corresponding DOM IDs
const ADMIN_TABS = [
    { id: 'chat', label: 'Chat', icon: 'fa-comments', action: 'exit' },
    { type: 'divider' },
    { type: 'label', label: 'Configuration' },
    { id: 'ai-config', label: 'Generation Settings', icon: 'fa-sliders', target: '#left-nav-panel' },
    { id: 'llm-config', label: 'LLM Connections', icon: 'fa-microchip', target: '#llm-config-panel' },
    { id: 'api-config', label: 'API Settings', icon: 'fa-plug', target: '#rm_api_block' },
    { type: 'divider' },
    { type: 'label', label: 'Management' },
    { id: 'characters', label: 'Characters', icon: 'fa-users', target: '#right-nav-panel' }, // #right-nav-panel
    { id: 'world-info', label: 'World Info', icon: 'fa-book-atlas', target: '#WorldInfo' },
    { id: 'extensions', label: 'Extensions', icon: 'fa-cubes', target: '#rm_extensions_block' },
    { type: 'divider' },
    { type: 'label', label: 'System' },
    { id: 'user-settings', label: 'User Settings', icon: 'fa-user-gear', target: '#user-settings-block' },
    { id: 'backgrounds', label: 'Backgrounds', icon: 'fa-image', target: '#Backgrounds' },
];

let isAdminModeActive = false;
let currentActiveTab = null;

function buildSidebar() {
    const sidebar = document.createElement('div');
    sidebar.id = 'admin-sidebar';
    
    const header = document.createElement('div');
    header.id = 'admin-sidebar-header';
    header.innerHTML = '<i class="fa-solid fa-layer-group"></i> <span>Console</span>';
    sidebar.appendChild(header);

    ADMIN_TABS.forEach(item => {
        if (item.type === 'divider') {
            const div = document.createElement('div');
            div.className = 'admin-nav-divider';
            sidebar.appendChild(div);
        } else if (item.type === 'label') {
            const div = document.createElement('div');
            div.className = 'admin-nav-label';
            div.innerText = item.label;
            sidebar.appendChild(div);
        } else {
            const navItem = document.createElement('div');
            navItem.className = 'admin-nav-item';
            navItem.dataset.id = item.id;
            navItem.innerHTML = `<i class="fa-solid ${item.icon}"></i><span>${item.label}</span>`;
            
            navItem.addEventListener('click', () => {
                if (item.action === 'exit') {
                    toggleAdminMode(false);
                } else {
                    switchTab(item);
                }
            });
            sidebar.appendChild(navItem);
        }
    });

    return sidebar;
}

function initAdminView() {
    // Create Overlay
    const overlay = document.createElement('div');
    overlay.id = 'admin-overlay';
    
    // Add Sidebar
    overlay.appendChild(buildSidebar());

    // Add Content Placeholder (just for spacing, content is docked via CSS)
    const contentArea = document.createElement('div');
    contentArea.id = 'admin-content-area';
    overlay.appendChild(contentArea);

    document.body.appendChild(overlay);

    // Add Trigger Button to Top Bar
    const topBar = document.getElementById('top-bar');
    if (topBar) {
        const trigger = document.createElement('div');
        trigger.id = 'admin-mode-trigger';
        trigger.className = 'drawer-icon';
        trigger.title = 'Open Management Console';
        trigger.innerHTML = '<i class="fa-solid fa-table-columns"></i>';
        trigger.addEventListener('click', () => toggleAdminMode(true));
        // Insert as first item or specific position
        topBar.insertBefore(trigger, topBar.firstChild);
    }
}

function switchTab(tabConfig) {
    // 1. Deactivate old tab
    if (currentActiveTab) {
        const oldTabEl = document.querySelector(`.admin-nav-item[data-id="${currentActiveTab.id}"]`);
        if (oldTabEl) oldTabEl.classList.remove('active');
        
        if (currentActiveTab.target) {
            const targetEl = document.querySelector(currentActiveTab.target);
            if (targetEl) {
                targetEl.classList.remove('docked-to-admin');
                // Attempt to restore original state? Mostly relies on ST's own logic hiding it
                // We might need to force hide it if it was "opened" via our logic
                // targetEl.style.display = ''; 
            }
        }
    }

    // 2. Activate new tab
    currentActiveTab = tabConfig;
    const newTabEl = document.querySelector(`.admin-nav-item[data-id="${tabConfig.id}"]`);
    if (newTabEl) newTabEl.classList.add('active');

    if (tabConfig.target) {
        const targetEl = document.querySelector(tabConfig.target);
        if (targetEl) {
            targetEl.classList.add('docked-to-admin');
            
            // Force display if hidden
            // Note: Many ST panels use specific classes like 'openDrawer' or inline styles
            if (targetEl.classList.contains('drawer-content')) {
                targetEl.classList.add('openDrawer'); // Ensure it thinks it's open
            }
            
            // Special handling for User Settings Block which is usually display:none
            if (tabConfig.id === 'user-settings') {
                $(targetEl).show();
            }
        }
    }
}

function toggleAdminMode(show) {
    const overlay = document.getElementById('admin-overlay');
    
    if (show) {
        isAdminModeActive = true;
        overlay.classList.add('active');
        document.body.classList.add('admin-mode-active');
        
        // Default to AI Config or first tab if none selected
        if (!currentActiveTab) {
            const defaultTab = ADMIN_TABS.find(t => t.id === 'ai-config');
            switchTab(defaultTab);
        } else {
            // Re-apply current tab to ensure docking works
            switchTab(currentActiveTab);
        }

    } else {
        isAdminModeActive = false;
        overlay.classList.remove('active');
        document.body.classList.remove('admin-mode-active');
        
        // Cleanup: remove docked class from current tab target
        if (currentActiveTab && currentActiveTab.target) {
            const targetEl = document.querySelector(currentActiveTab.target);
            if (targetEl) {
                targetEl.classList.remove('docked-to-admin');
                
                // Close drawer if it was opened by us
                if (targetEl.classList.contains('drawer-content')) {
                    targetEl.classList.remove('openDrawer');
                }
                if (currentActiveTab.id === 'user-settings') {
                    $(targetEl).hide();
                }
            }
        }
        // Don't clear currentActiveTab so we return to it next time? 
        // Or clear it? Let's keep it.
    }
}

// Initialize on load
jQuery(document).ready(() => {
    initAdminView();
});

