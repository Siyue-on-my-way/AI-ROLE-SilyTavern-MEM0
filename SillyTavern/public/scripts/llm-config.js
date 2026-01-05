import {
    saveSettingsDebounced,
} from '../script.js';
import { oai_settings } from './openai.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';

const llmChatSelect = document.getElementById('llm_chat_model_select');
const llmMemorySelect = document.getElementById('llm_memory_model_select');
const mem0SaveButton = document.getElementById('mem0_save_config');
const mem0AddModelButton = document.getElementById('mem0_add_model');

const llmConfigStatus = document.getElementById('llm_config_status');
const llmDrawerButton = document.querySelector('#llm-config-button .drawer-toggle');
const llmDrawerContent = document.querySelector('#llm-config-button .drawer-content');
const llmDrawerIcon = document.getElementById('llmConfigDrawerIcon');

let initialChatModel = '';
let pendingChatModel = '';
let initialMemoryValue = '';
let pendingMemoryValue = '';

function setStatus(text) {
    if (llmConfigStatus) llmConfigStatus.innerText = text;
}

function getMem0ApiUrl() {
    const configured = String(oai_settings?.mem0_base_url || '').trim();
    if (configured) return configured.replace(/\/+$/, '');
    const protocol = window.location.protocol || 'http:';
    const hostname = window.location.hostname;
    const port = String(window.location.port || '').trim();
    if (port === '58000') return `${protocol}//${hostname}:58001`;
    if (port === '8000') return `${protocol}//${hostname}:8001`;
    return `${protocol}//${hostname}:8001`;
}

function setButtonDisabled(button, disabled) {
    if (!button) return;
    button.disabled = Boolean(disabled);
    button.classList.toggle('disabled', Boolean(disabled));
}

function parseMemoryValue(value) {
    const raw = String(value || '');
    const idx = raw.indexOf('::');
    if (idx === -1) return null;
    const provider = raw.slice(0, idx).trim();
    const model = raw.slice(idx + 2).trim();
    if (!provider || !model) return null;
    return { provider, model };
}

async function fetchConfig() {
    try {
        const response = await fetch(`${getMem0ApiUrl()}/config`);
        if (!response.ok) throw new Error('Failed to fetch config');
        return await response.json();
    } catch (error) {
        console.error('Error fetching config:', error);
        return null;
    }
}

async function fetchModels() {
    try {
        const response = await fetch(`${getMem0ApiUrl()}/models`);
        if (!response.ok) throw new Error('Failed to fetch models');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching models:', error);
        setStatus('Error loading models from Mem0');
        return null;
    }
}

function normalizeModelItem(item) {
    if (!item) return null;
    if (typeof item === 'string') return { model: item, label: item, custom: false };
    if (typeof item === 'object') {
        const model = String(item.model || '').trim();
        if (!model) return null;
        const label = String(item.label || model).trim() || model;
        return { model, label, custom: Boolean(item.custom) };
    }
    return null;
}

function flattenModels(modelsData) {
    if (!modelsData) return [];
    let allModels = [];
    for (const models of Object.values(modelsData)) {
        if (!Array.isArray(models)) continue;
        for (const item of models) {
            const normalized = normalizeModelItem(item);
            if (!normalized) continue;
            allModels.push(normalized.model);
        }
    }
    return [...new Set(allModels)];
}

function populateChatModelSelect(models) {
    if (!llmChatSelect) return;

    const items = Array.isArray(models) ? [...models] : [];
    const current = String(oai_settings?.openai_model || '').trim();
    if (current && !items.includes(current)) items.push(current);

    llmChatSelect.innerHTML = '';
    if (items.length === 0) {
        llmChatSelect.innerHTML = '<option disabled>No models found</option>';
        return;
    }

    items.forEach(model => {
        const opt = document.createElement('option');
        opt.value = model;
        opt.innerText = model;
        llmChatSelect.appendChild(opt);
    });
}

function populateMemoryModelSelect(modelsData) {
    if (!llmMemorySelect) return;
    llmMemorySelect.innerHTML = '';

    const providerOrder = ['openai', 'azure_openai', 'anthropic', 'ollama'];
    const providers = Object.keys(modelsData || {});
    providers.sort((a, b) => {
        const ai = providerOrder.indexOf(a);
        const bi = providerOrder.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });

    const values = new Set();
    for (const provider of providers) {
        const list = modelsData?.[provider];
        if (!Array.isArray(list) || list.length === 0) continue;
        for (const item of list) {
            const normalized = normalizeModelItem(item);
            if (!normalized) continue;
            const value = `${provider}::${normalized.model}`;
            if (values.has(value)) continue;
            values.add(value);
            const opt = document.createElement('option');
            opt.value = value;
            opt.innerText = provider === 'openai' ? normalized.label : `${normalized.label} (${provider})`;
            llmMemorySelect.appendChild(opt);
        }
    }
}

function updateSaveButtonState() {
    const dirty = (pendingChatModel && pendingChatModel !== initialChatModel) || (pendingMemoryValue && pendingMemoryValue !== initialMemoryValue);
    setButtonDisabled(mem0SaveButton, !dirty);
}

async function initLLMConfig() {
    const modelsData = await fetchModels();
    const currentConfig = await fetchConfig();
    const flatModels = flattenModels(modelsData);

    if (llmChatSelect) {
        populateChatModelSelect(flatModels);
    }

    initialChatModel = String(oai_settings?.openai_model || '').trim();
    pendingChatModel = initialChatModel;
    if (llmChatSelect) {
        if (pendingChatModel) {
            llmChatSelect.value = pendingChatModel;
        } else {
            pendingChatModel = String(llmChatSelect.value || '').trim();
        }
    }

    if (currentConfig?.llm?.provider && currentConfig?.llm?.config?.model) {
        initialMemoryValue = `${String(currentConfig.llm.provider).trim()}::${String(currentConfig.llm.config.model).trim()}`;
    } else {
        initialMemoryValue = '';
    }
    pendingMemoryValue = initialMemoryValue;

    if (llmMemorySelect) {
        if (modelsData) {
            populateMemoryModelSelect(modelsData);
        } else {
            llmMemorySelect.innerHTML = '';
        }
    }
    if (llmMemorySelect && pendingMemoryValue) {
        const exists = Array.from(llmMemorySelect.options).some(o => o.value === pendingMemoryValue);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = pendingMemoryValue;
            opt.innerText = pendingMemoryValue;
            llmMemorySelect.appendChild(opt);
        }
        llmMemorySelect.value = pendingMemoryValue;
    }

    updateSaveButtonState();

    if (llmChatSelect) {
        llmChatSelect.addEventListener('change', () => {
            pendingChatModel = String(llmChatSelect.value || '').trim();
            updateSaveButtonState();
        });
    }

    if (llmMemorySelect) {
        llmMemorySelect.addEventListener('change', () => {
            pendingMemoryValue = String(llmMemorySelect.value || '').trim();
            updateSaveButtonState();
        });
    }

    if (mem0SaveButton) {
        mem0SaveButton.addEventListener('click', async () => {
            const dirty = (pendingChatModel && pendingChatModel !== initialChatModel) || (pendingMemoryValue && pendingMemoryValue !== initialMemoryValue);
            if (!dirty) return;

            setButtonDisabled(mem0SaveButton, true);
            setStatus('Saving...');

            try {
                if (pendingChatModel && pendingChatModel !== initialChatModel) {
                    oai_settings.openai_model = pendingChatModel;
                    saveSettingsDebounced();
                    initialChatModel = pendingChatModel;
                }

                if (pendingMemoryValue && pendingMemoryValue !== initialMemoryValue) {
                    const parsed = parseMemoryValue(pendingMemoryValue);
                    if (!parsed) {
                        setStatus('请选择有效的 Memoration 模型');
                        updateSaveButtonState();
                        return;
                    }

                    const res = await fetch(`${getMem0ApiUrl()}/configure`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            llm: {
                                provider: parsed.provider,
                                config: {
                                    model: parsed.model,
                                    temperature: 0.2,
                                },
                            },
                        }),
                    });

                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        setStatus(`Error: ${err.detail || 'Failed to save'}`);
                        updateSaveButtonState();
                        return;
                    }

                    initialMemoryValue = pendingMemoryValue;
                }

                setStatus('Saved');
            } catch (e) {
                console.error(e);
                setStatus('Network error');
                updateSaveButtonState();
                return;
            }

            updateSaveButtonState();
            setTimeout(() => { if (llmConfigStatus) llmConfigStatus.innerText = ''; }, 3000);
        });
    }

    if (mem0AddModelButton) {
        mem0AddModelButton.addEventListener('click', async () => {
            const popup = new Popup(
                '<h3>Add LLM</h3>',
                POPUP_TYPE.TEXT,
                '',
                {
                    okButton: '保存',
                    cancelButton: '取消',
                    customInputs: [
                        { id: 'mem0_llm_rename', label: 'Rename', type: 'text' },
                        { id: 'mem0_llm_url', label: 'URL', type: 'text', tooltip: 'https://api.openai.com/v1' },
                        { id: 'mem0_llm_api_key', label: 'API Key', type: 'text' },
                        { id: 'mem0_llm_model', label: 'Model Name', type: 'text' },
                    ],
                    onOpen: (p) => {
                        const apiKeyInput = p.dlg.querySelector('#mem0_llm_api_key');
                        if (apiKeyInput) apiKeyInput.type = 'password';
                    },
                    onClosing: async (p) => {
                        if (p.result !== POPUP_RESULT.AFFIRMATIVE) return true;
                        const rename = String(p.inputResults?.get('mem0_llm_rename') || '').trim();
                        const url = String(p.inputResults?.get('mem0_llm_url') || '').trim();
                        const apiKey = String(p.inputResults?.get('mem0_llm_api_key') || '').trim();
                        const model = String(p.inputResults?.get('mem0_llm_model') || '').trim();

                        if (!model) {
                            setStatus('Model Name 不能为空');
                            setTimeout(() => { if (llmConfigStatus) llmConfigStatus.innerText = ''; }, 3000);
                            return false;
                        }

                        setStatus('Adding...');
                        try {
                            const res = await fetch(`${getMem0ApiUrl()}/models`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    provider: 'openai',
                                    model,
                                    label: rename || undefined,
                                    base_url: url || undefined,
                                    api_key: apiKey || undefined,
                                }),
                            });
                            if (!res.ok) {
                                const err = await res.json().catch(() => ({}));
                                setStatus(`Error: ${err.detail || 'Failed to add'}`);
                                setTimeout(() => { if (llmConfigStatus) llmConfigStatus.innerText = ''; }, 3000);
                                return false;
                            }
                        } catch (e) {
                            console.error(e);
                            setStatus('Network error');
                            setTimeout(() => { if (llmConfigStatus) llmConfigStatus.innerText = ''; }, 3000);
                            return false;
                        }

                        const modelsData = await fetchModels();
                        populateMemoryModelSelect(modelsData);
                        const flatModels = flattenModels(modelsData);
                        populateChatModelSelect(flatModels);

                        if (llmMemorySelect) {
                            const value = `openai::${model}`;
                            const exists = Array.from(llmMemorySelect.options).some(o => o.value === value);
                            if (!exists) {
                                const opt = document.createElement('option');
                                opt.value = value;
                                opt.innerText = rename || model;
                                llmMemorySelect.appendChild(opt);
                            }
                            llmMemorySelect.value = value;
                            pendingMemoryValue = value;
                            updateSaveButtonState();
                        }

                        setStatus('Added');
                        setTimeout(() => { if (llmConfigStatus) llmConfigStatus.innerText = ''; }, 3000);
                        return true;
                    },
                },
            );
            await popup.show();
        });
    }

    if (llmDrawerButton) {
        $(llmDrawerButton).on('click', function() {
            $(llmDrawerContent).toggleClass('closedDrawer');
            if (llmDrawerIcon) {
                $(llmDrawerIcon).toggleClass('closedIcon');
            }
        });
    }
}

$(document).ready(() => {
    initLLMConfig();
});
