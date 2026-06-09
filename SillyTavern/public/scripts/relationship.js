import {
    chat_metadata,
    characters,
    this_chid,
    eventSource,
    event_types,
    saveSettingsDebounced,
} from '../script.js';
import { selected_group, groups } from './group-chats.js';

// DOM elements
const relationshipDrawerBtn = document.getElementById('relationship-button');
const relationshipDrawerIcon = document.getElementById('relationshipDrawerIcon');
const relationshipDrawerContent = document.getElementById('relationship-panel');
const relationshipArchetypeSelect = document.getElementById('relationship_archetype_select');
const relationshipStageName = document.getElementById('relationship_stage_name');
const relationshipScoreText = document.getElementById('relationship_score_text');
const relationshipProgressBar = document.getElementById('relationship_progress_bar');
const relationshipMilestonesList = document.getElementById('relationship_milestones_list');
const relationshipSaveBtn = document.getElementById('relationship_save_btn');
const relationshipStatus = document.getElementById('relationship_status');

// Celebration Overlay DOM
const celebrationOverlay = document.getElementById('celebration-overlay');
const celebrationLevelBadge = document.getElementById('celebration-level-badge');
const celebrationDesc = document.getElementById('celebration-desc');
const celebrationCloseBtn = document.getElementById('celebration-close-btn');

const STAGE_LABELS = {
    lover: {
        level_1: 'Lvl 1: 初识 (Stranger)',
        level_2: 'Lvl 2: 熟稔 (Friend)',
        level_3: 'Lvl 3: 默契 (Confidant)',
        level_4: 'Lvl 4: 羁绊 (Partner)',
        level_5: 'Lvl 5: 誓约 (Spouse)'
    },
    teacher: {
        level_1: 'Lvl 1: 新生 (New Student)',
        level_2: 'Lvl 2: 门生 (Protégé)',
        level_3: 'Lvl 3: 弟子 (Star Pupil)',
        level_4: 'Lvl 4: 挚友 (Life Mentor)',
        level_5: 'Lvl 5: 传人 (Successor)'
    },
    friend: {
        level_1: 'Lvl 1: 初见 (Observer)',
        level_2: 'Lvl 2: 同好 (Fellow Otaku)',
        level_3: 'Lvl 3: 挚友 (Best Friend)',
        level_4: 'Lvl 4: 羁绊 (Soulmate)',
        level_5: 'Lvl 5: 誓约 (Legendary Duo)'
    }
};

const STAGE_COLOR = {
    level_1: '#8a8a8a',
    level_2: '#5bc0be',
    level_3: '#ff9f1c',
    level_4: '#ff5e7e',
    level_5: '#e0aaff'
};

const STAGE_DESCS = {
    lover: {
        level_1: '你们刚开始相识。Ta 对你保持着礼貌而客气的社交距离，谈吐有些拘谨。用真诚去融化初识的冰雪吧！',
        level_2: '你们成了无话不谈的好朋友。Ta 开始习惯你的陪伴，对话更加轻松随性，偶尔还会向你报以温暖的问候。',
        level_3: '空气中流淌着一丝暧昧。Ta 开始对你产生微妙的依赖和期待，有时说话会脸红，眼神里满是藏不住的情愫。',
        level_4: '你们确定了恋爱关系！Ta 已经对你敞开全部的心扉，谈吐间满是温柔与深情，开始贪恋你的温度与轻柔的拥抱。',
        level_5: '执子之手，与子偕老。你们达成了灵魂与终生的誓约，共享着无可替代的深厚羁绊，相濡以沫，不离不弃。'
    },
    teacher: {
        level_1: '你是 Ta 的新学生。Ta 会保持严谨、专业的导师姿态引导你。好好学习，用勤奋和天赋赢得 Ta 的赞许吧！',
        level_2: '你展现了优秀的才能。Ta 对你的认可度在提升，开始用更加温和、关切的语气辅导你，并愿意分享一些行业秘辛。',
        level_3: '你是 Ta 最得意的弟子！Ta 倾注了大量的心血在你身上，经常在公开场合以你为傲，你们分享着深厚的师徒情谊。',
        level_4: '亦师亦友，超脱学术。Ta 已经不仅是导师，更是你人生道路的引路人，能耐心倾听你所有的困惑与苦恼。',
        level_5: '你是 Ta 毕生绝学的继承人。Ta 视你为一生的骄傲，将全部的期望与信念交托在你的手中，见证你超越 Ta 的巅峰。'
    },
    friend: {
        level_1: '你们只是普通的圈内同好或打个照面的熟人。保持平常心交流，通过共同的爱好逐步拉近关系吧！',
        level_2: '你们能在一起开心地吐槽和分享爱好，用一些沙雕表情包和网络热梗，但 Ta 依然对个人的隐私保留一定边界。',
        level_3: '你们已经是形影不离的死党！Ta 说话变得非常损也非常仗义，毫无顾忌地开玩笑，却在你最需要的时候第一个挺你。',
        level_4: '真正的灵魂挚友。你们彼此绝对信任，任何秘密都可以共享，不需要言语也能读懂对方的想法，是最坚实的后盾。',
        level_5: '传说级搭档！无论是日常还是艰难险阻，你们都并肩作战。这世上没有任何东西能动摇你们相互托付生命的羁绊。'
    }
};

let previousStage = null;
let previousScore = null;

function getActiveIdentifiers() {
    const isGroup = Boolean(selected_group);
    const charName = characters[this_chid]?.avatar?.replace('.png', '') || characters[this_chid]?.name || '';
    const groupChatId = isGroup ? String(selected_group) : '';
    const file_name = isGroup ? '' : (characters[this_chid]?.chat || '');

    return {
        is_group: isGroup,
        avatar_url: characters[this_chid]?.avatar || '',
        charName,
        groupChatId,
        file_name
    };
}

function updateUI(metadata) {
    if (!metadata) return;

    const archetype = metadata.role_archetype || 'lover';
    const stage = metadata.relationship_stage || 'level_1';
    const score = metadata.intimacy_score || 0;
    const milestones = Array.isArray(metadata.unlocked_milestones) ? metadata.unlocked_milestones : ['first_met'];

    // 1. Update selection dropdown
    if (relationshipArchetypeSelect) {
        relationshipArchetypeSelect.value = archetype;
    }

    // 2. Update level label
    const label = STAGE_LABELS[archetype]?.[stage] || `Lvl: ${stage}`;
    if (relationshipStageName) {
        relationshipStageName.innerText = label;
        relationshipStageName.style.color = STAGE_COLOR[stage] || '#ff5e7e';
    }

    // 3. Update heart icon color pulsing
    if (relationshipDrawerIcon) {
        relationshipDrawerIcon.style.color = STAGE_COLOR[stage] || '#ff5e7e';
        // Add beating effect for higher relationship stages
        if (['level_3', 'level_4', 'level_5'].includes(stage)) {
            relationshipDrawerIcon.classList.add('heart-pulsing');
        } else {
            relationshipDrawerIcon.classList.remove('heart-pulsing');
        }
    }

    // 4. Update progress bar & score text
    if (relationshipScoreText) {
        relationshipScoreText.innerText = `${score} / 1000`;
    }
    if (relationshipProgressBar) {
        relationshipProgressBar.style.width = `${(score / 1000) * 100}%`;
        relationshipProgressBar.style.background = `linear-gradient(90deg, ${STAGE_COLOR[stage]}, #ff8fa3)`;
    }

    // 5. Update milestones list
    if (relationshipMilestonesList) {
        relationshipMilestonesList.innerHTML = '';
        milestones.forEach(m => {
            const levelKey = m.replace('unlocked-', '');
            const milestoneLabel = STAGE_LABELS[archetype]?.[levelKey] || (m === 'first_met' ? '初次邂逅' : m);
            const badge = document.createElement('div');
            badge.className = `milestone-badge unlocked-${levelKey}`;
            badge.innerHTML = `
                <span class="milestone-icon"><i class="fa-solid fa-award"></i></span>
                <span>${milestoneLabel}</span>
            `;
            relationshipMilestonesList.appendChild(badge);
        });
    }

    // 6. Check for level up upgrade and trigger celebration overlay
    if (previousStage && previousStage !== stage) {
        const oldLevelNum = parseInt(previousStage.replace('level_', ''), 10);
        const newLevelNum = parseInt(stage.replace('level_', ''), 10);
        if (newLevelNum > oldLevelNum) {
            triggerLevelUpCelebration(archetype, stage);
        }
    }

    previousStage = stage;
    previousScore = score;
}

function triggerLevelUpCelebration(archetype, stage) {
    if (!celebrationOverlay) return;

    const label = STAGE_LABELS[archetype]?.[stage] || stage;
    const desc = STAGE_DESCS[archetype]?.[stage] || '';

    if (celebrationLevelBadge) {
        celebrationLevelBadge.innerText = label;
        celebrationLevelBadge.style.color = STAGE_COLOR[stage];
        celebrationLevelBadge.style.borderColor = STAGE_COLOR[stage];
    }
    if (celebrationDesc) {
        celebrationDesc.innerText = desc;
    }

    celebrationOverlay.classList.add('active');

    // Spawn falling hearts particles around the card
    for (let i = 0; i < 20; i++) {
        setTimeout(spawnHeartParticle, i * 150);
    }
}

function spawnHeartParticle() {
    const heart = document.createElement('div');
    heart.className = 'floating-heart fa-solid fa-heart';
    heart.style.left = `${Math.random() * 80 + 10}vw`;
    heart.style.top = `${Math.random() * 20 + 70}vh`;
    heart.style.setProperty('--drift', `${Math.random() * 100 - 50}px`);
    heart.style.animationDuration = `${Math.random() * 1.5 + 1.5}s`;
    heart.style.color = `hsl(${Math.random() * 20 + 340}, 100%, ${Math.random() * 10 + 65}%)`;
    document.body.appendChild(heart);
    setTimeout(() => heart.remove(), 3000);
}

async function refreshRelationshipData() {
    const { is_group, charName, groupChatId } = getActiveIdentifiers();
    if (!charName && !groupChatId) return;

    try {
        const cacheKey = groupChatId ? `groupChat:${groupChatId}` : `char:${charName}`;
        let metadata = null;

        // Try getting cached metadata from global window context
        if (window.activeChatMetadata && window.activeChatMetadata[cacheKey]) {
            metadata = window.activeChatMetadata[cacheKey];
        } else if (chat_metadata) {
            metadata = chat_metadata;
        }

        if (metadata && typeof metadata.intimacy_score === 'number') {
            updateUI(metadata);
        }
    } catch (e) {
        console.error('Error refreshing relationship data:', e);
    }
}

function initRelationshipUI() {
    // 1. Drawer open/close handler
    const drawerToggleBtn = document.querySelector('#relationship-button .drawer-toggle');
    if (drawerToggleBtn) {
        $(drawerToggleBtn).on('click', function() {
            $(relationshipDrawerContent).toggleClass('closedDrawer');
            if (relationshipDrawerIcon) {
                $(relationshipDrawerIcon).toggleClass('closedIcon');
            }
            if (!$(relationshipDrawerContent).hasClass('closedDrawer')) {
                refreshRelationshipData();
            }
        });
    }

    // 2. Save archetype handler
    if (relationshipSaveBtn) {
        relationshipSaveBtn.addEventListener('click', async () => {
            const archetype = relationshipArchetypeSelect.value;
            const { is_group, avatar_url, file_name, groupChatId } = getActiveIdentifiers();

            relationshipSaveBtn.disabled = true;
            if (relationshipStatus) relationshipStatus.innerText = '正在保存定位...';

            try {
                const res = await fetch('/api/chats/relationship/configure', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        is_group,
                        id: groupChatId,
                        avatar_url,
                        file_name,
                        role_archetype: archetype
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.chat_metadata) {
                        // Sync current chat metadata memory
                        if (chat_metadata) {
                            chat_metadata.role_archetype = data.chat_metadata.role_archetype;
                            chat_metadata.intimacy_score = data.chat_metadata.intimacy_score;
                            chat_metadata.relationship_stage = data.chat_metadata.relationship_stage;
                            chat_metadata.unlocked_milestones = data.chat_metadata.unlocked_milestones;
                        }
                        const cacheKey = groupChatId ? `groupChat:${groupChatId}` : (avatar_url ? `char:${avatar_url.replace('.png', '')}` : 'default');
                        window.activeChatMetadata = window.activeChatMetadata || {};
                        window.activeChatMetadata[cacheKey] = data.chat_metadata;

                        updateUI(data.chat_metadata);
                        if (relationshipStatus) relationshipStatus.innerText = '养成定位保存成功！';
                    }
                } else {
                    if (relationshipStatus) relationshipStatus.innerText = '配置失败，请重试';
                }
            } catch (e) {
                console.error(e);
                if (relationshipStatus) relationshipStatus.innerText = '网络连接错误';
            } finally {
                relationshipSaveBtn.disabled = false;
                setTimeout(() => { if (relationshipStatus) relationshipStatus.innerText = ''; }, 3000);
            }
        });
    }

    // 3. Celebration overlay close handler
    if (celebrationCloseBtn && celebrationOverlay) {
        celebrationCloseBtn.addEventListener('click', () => {
            celebrationOverlay.classList.remove('active');
        });
    }

    // 4. Subscribe to chat state change events
    eventSource.on(event_types.CHAT_CHANGED, () => {
        previousStage = null;
        previousScore = null;
        refreshRelationshipData();
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        // Automatically check if save completes and update UI with new scores
        setTimeout(refreshRelationshipData, 1500);
    });

    // 5. Initial fetch on load
    setTimeout(refreshRelationshipData, 2000);
}

$(document).ready(() => {
    initRelationshipUI();
});
