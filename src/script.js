if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

var bgm = new Audio();
bgm.loop = true;

let bgmVolume = 0.5;
const rerollCost = 1000;

var gameState = 'start';
var frameCount = 0;
var score = 0;
var isTutorialMode = false;
var tutorialStep = 0;
var tutorialTimer = 0;
let gameTimeDifficulty = 0;

// ボス戦関連の変数
let isBossActive = false;
let bossDefeatedCount = 0;
let timeToNextBoss = 60 * 60; // 60秒 (60fps換算)
let bossWarningTimer = 0;

// 新しいエフェクト用の変数
let screenShake = { magnitude: 0, duration: 0 };
let hitStopTimer = 0;
let shockwaves = [];

const input = { x: canvas.width / 2, y: canvas.height - 50 };
const keys = { w: false, a: false, s: false, d: false };
var player = {
    x: 120, y: 280, w: 8, h: 8,
    hp: 100, maxHp: 100,
    level: 1, xp: 0, nextLevelXp: 10,
    bulletCount: 1, fireRate: 20, damage: 10,
    bulletSpeed: 5, bulletSize: 4, spread: 0.1, pierce: 0,
    agility: 0.2, xpGainMultiplier: 1.0, critChance: 0.05, critDamage: 1.5,
    baseColor: '#0ff', // 元の色を保持
    doctrine: null,
    doctrineKillCount: 0,
    hasInversionPulse: false,
    hasExplosionEnlarge: false,
    shotCount: 0,
    nextExplosiveShot: Math.floor(3 + Math.random() * 8)
};

var bullets = [];
var enemies = [];
var particles = [];
var xpGems = [];
var enemyBullets = [];
var slashes = [];
let screenInvertTimer = 0;
let pulseTimer = 0;
let nextPulseTime = 0;
let stars = [];
for(let i=0; i<50; i++) {
    stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        speed: 0.5 + Math.random() * 2,
        baseColor: Math.random() > 0.8 ? '#fff' : '#555'
    });
}

const tutorialSteps = [
    {
        message: "WELCOME TO INFINITY PIXEL STORM!\nLET'S LEARN THE BASICS.",
        check: () => frameCount > 180, // 3 seconds
    },
    {
        message: "DRAG or use WASD/ARROWS to MOVE.",
        check: () => {
            const dx = player.x - (canvas.width / 2);
            const dy = player.y - (canvas.height - 50);
            return Math.sqrt(dx*dx + dy*dy) > 40;
        }
    },
    {
        message: "GOOD. ATTACKS ARE AUTOMATIC.\nENEMIES ARE APPROACHING!",
        action: () => {
             for(let i=0; i<3; i++) {
                 enemies.push({
                     x: 40 + i*80, y: -20, w: 16, h: 16, hp: 5, speed: 0.5,
                     sway: 0, offset: 0, fireRate: 1000, baseColor: '#0ff'
                 });
             }
        },
        check: () => score >= 300
    },
    {
        message: "COLLECT GREEN XP GEMS\nTO LEVEL UP!",
        check: () => player.level > 1
    },
    {
        message: "LEVELING UP LETS YOU CHOOSE UPGRADES.\nSELECT ONE TO CONTINUE.",
        check: () => gameState === 'playing' && player.level > 1
    },
    {
        message: "WATCH OUT FOR RED CHARGERS!\nTHEY ARE FAST!",
        action: () => {
            enemies.push({
                x: canvas.width / 2, y: -20, w: 20, h: 20, hp: 5,
                speed: 2, sway: 0, offset: 0, fireRate: 1000,
                baseColor: '#f00', isCharger: true, chargeTimer: 60
            });
        },
        check: () => enemies.length === 0 && score >= 400
    },
    {
        message: "BOSS APPROACHING! BOSSES HAVE SPECIAL MECHANICS.\nFIRST, THE TIMING CORE.",
        action: () => {
            spawnBoss();
            if (enemies[0]) {
                enemies[0].hp = 100000; 
                enemies[0].timingCore.state = 'active';
                enemies[0].timingCore.timer = 999;
            }
        },
        check: () => enemies[0] && enemies[0].timingCoreSuccess
    },
    {
        message: "EXCELLENT! NEXT: QUICK TAP.\nTAP THE 'TAP!' PROMPT OR PRESS SPACE!",
        action: () => {
            if (enemies[0]) {
                enemies[0].quickTap.state = 'active';
                enemies[0].quickTap.timer = 999;
                enemies[0].quickTap.x = canvas.width / 2;
                enemies[0].quickTap.y = canvas.height / 2;
            }
        },
        check: () => enemies[0] && enemies[0].quickTapSuccess
    },
    {
        message: "BEWARE OF THE LASER!\nMOVE AWAY FROM THE LINE!",
        action: () => {
            if (enemies[0]) {
                enemies[0].laserState = 'aiming';
                enemies[0].laserTimer = 60;
                enemies[0].laserTargetX = player.x;
                enemies[0].laserTargetY = player.y;
            }
        },
        check: () => enemies[0] && enemies[0].laserState === 'firing'
    },
    {
        message: "STAY OUT OF THE BEAM!",
        check: () => enemies[0] && enemies[0].laserState === 'idle'
    },
    {
        message: "NOW, FINISH THE BOSS!",
        action: () => {
            if (enemies[0]) {
                enemies[0].hp = 1000;
            }
        },
        check: () => !isBossActive && bossDefeatedCount > 0
    },
    {
        message: "TUTORIAL COMPLETE!\nPREPARE FOR THE REAL STORM.",
        check: () => true,
    }
];

const upgradePool = [
    { name: "MULTI SHOT", desc: "弾数が+1増える", apply: () => { player.bulletCount++; player.spread += 0.05; } },
    { name: "RAPID FIRE", desc: "連射速度UP", apply: () => { player.fireRate = Math.max(2, player.fireRate * 0.85); } }, // 連射上限設定
    { name: "BIGGER BULLET", desc: "弾サイズと威力UP", apply: () => { player.bulletSize += 1.5; player.damage *= 1.4; } },
    { name: "WIDE SPREAD", desc: "攻撃範囲が広がる", apply: () => { player.spread += 0.25; player.bulletCount++; } },
    { name: "PIERCING", desc: "弾が敵を貫通する", apply: () => { player.pierce++; player.damage *= 0.9; } },
    { name: "VIT UP", desc: "最大HP回復＆増加", apply: () => { player.maxHp += 50; player.hp = player.maxHp; } },
    { name: "CHAOS BEAM", desc: "制御不能な高威力弾", apply: () => { player.damage *= 1.8; player.spread += 0.4; player.bulletCount += 2; } },
    { name: "AGILITY UP", desc: "移動の追従性がUP", apply: () => { player.agility = Math.min(1.0, player.agility + 0.08); } },
    { name: "BULLET SPEED UP", desc: "弾の速度がUP", apply: () => { player.bulletSpeed += 1.5; } },
    { name: "LEARNING", desc: "取得経験値が15%UP", apply: () => { player.xpGainMultiplier += 0.15; } },
    { name: "CRITICAL HIT", desc: "クリティカル率+5%", apply: () => { player.critChance += 0.05; } },
    { name: "CRITICAL DAMAGE", desc: "クリティカルダメージ+50%", apply: () => { player.critDamage += 0.5; } },
    { name: "INV PULSE", desc: "敵をスロー＆画面反転", apply: () => { player.hasInversionPulse = true; } },
    { name: "EXPLOSION", desc: "数発に1回、着弾時に爆発する", apply: () => { player.hasExplosionEnlarge = true; } }
];

const doctrinePool = [
    { id: 'reflect', name: "REFLECT", desc: "自弾の画面枠での一回反射" },
    { id: 'curve', name: "CURVE", desc: "自弾のカーブ" },
    { id: 'shield', name: "SHIELD", desc: "時機の周りをまわる2つの盾" },
    { id: 'heal', name: "HEAL", desc: "敵を5体倒したら負のHPの半分を回復" },
    { id: 'lastStand', name: "LAST STAND", desc: "HPが低いほど攻撃速度&会心率UP" }
];
const doctrineCost = 1000;

// --- 色調変換関数 ---
// ボス戦中は強制的にグレー階調の色を返す
function getColor(originalColor, type = 'normal') {
    if (!isBossActive) return originalColor;

    // タイプに応じてグレーの色味を変える
    switch(type) {
        case 'player': return '#fff'; // プレイヤーは白
        case 'pBullet': return '#ccc'; // プレイヤー弾は明るいグレー
        case 'enemy': return '#888';  // 敵は中間グレー
        case 'boss': return '#fff';   // ボスは白（目立たせる）
        case 'eBullet': return '#555'; // 敵弾は暗いグレー
        case 'xp': return '#aaa';      // XPはやや明るいグレー
        case 'bg': return '#222';      // 背景（星など）
        case 'particle': return '#999';
        default: return '#888';
    }
}

function updateInputPosition(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    input.x = (clientX - rect.left) * (canvas.width / rect.width);
    input.y = (clientY - rect.top) * (canvas.height / rect.height);
}
window.addEventListener('mousemove', e => { if(gameState === 'playing') updateInputPosition(e.clientX, e.clientY); });
window.addEventListener('touchmove', e => { e.preventDefault(); if(gameState === 'playing') updateInputPosition(e.touches[0].clientX, e.touches[0].clientY); }, {passive: false});

function handleTap(clientX, clientY) {
    if (gameState !== 'playing') return;
    
    enemies.forEach(e => {
        if (e.isBoss && e.quickTap && e.quickTap.state === 'active') {
            const qte = e.quickTap;
            e.hp -= 800 * (bossDefeatedCount + 1);
            e.quickTapSuccess = true; // For tutorial
            qte.state = 'cooldown';
            qte.timer = 180 + Math.random() * 120;
            
            triggerScreenShake(20, 30);
            triggerHitStop(10);
            screenInvertTimer = 8;
            
            const angle1 = Math.random() * Math.PI;
            const dist = 60;
            triggerSlash(
                e.x - Math.cos(angle1) * dist, e.y - Math.sin(angle1) * dist,
                e.x + Math.cos(angle1) * dist, e.y + Math.sin(angle1) * dist
            );
            const angle2 = angle1 + Math.PI/2 + (Math.random()-0.5);
            triggerSlash(
                e.x - Math.cos(angle2) * dist, e.y - Math.sin(angle2) * dist,
                e.x + Math.cos(angle2) * dist, e.y + Math.sin(angle2) * dist
            );
            
            createParticles(e.x, e.y, '#fff', 30);
            
            for(let i=0; i<3; i++) {
                particles.push({
                    x: e.x + (Math.random()-0.5)*40, y: e.y + (Math.random()-0.5)*40,
                    vx: (Math.random()-0.5)*2, vy: (Math.random()-0.5)*2,
                    life: 1.0, size: 0, baseColor: '#fff', isText: true, text: 'SLASH!'
                });
            }
        }
    });
}

window.addEventListener('mousedown', e => {
    handleTap(e.clientX, e.clientY);
});
window.addEventListener('touchstart', e => {
    handleTap(e.touches[0].clientX, e.touches[0].clientY);
});

window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        togglePause();
    }
    if (e.key === ' ' || e.code === 'Space') {
        if (gameState === 'playing') {
            handleTap(0, 0);
            e.preventDefault();
        }
    }
    if (keys.hasOwnProperty(e.key.toLowerCase())) {
        keys[e.key.toLowerCase()] = true;
    }
});
window.addEventListener('keyup', e => {
    if (keys.hasOwnProperty(e.key.toLowerCase())) {
        keys[e.key.toLowerCase()] = false;
    }
});


function startGame(tutorial = false) {
    document.getElementById('startMenu').style.display = 'none';
    resetGameData();
    if (tutorial) {
        isTutorialMode = true;
        tutorialStep = 0;
        tutorialTimer = 0;
        timeToNextBoss = 999999; // チュートリアル中は自然にボスを出さない
        if (tutorialSteps[0].action) tutorialSteps[0].action();
    }

    const bgmSelect = document.getElementById('bgmSelect');
    bgm.src = bgmSelect.value;
    bgm.volume = bgmVolume;
    bgm.play().catch(e => console.error("BGM play failed:", e));

    gameState = 'playing';
    loop();
}
function resetGame() {
    document.getElementById('gameOverMenu').style.display = 'none';
    document.getElementById('pauseMenu').style.display = 'none';
    resetGameData(); // 内部でbgm.pause()が呼ばれる

    // BGMを再度選択して再生
    const bgmSelect = document.getElementById('bgmSelect');
    bgm.src = bgmSelect.value;
    // updateVolumeを呼び出して音量とミュート状態を正しく適用する
    updateVolume(bgmVolume, bgm.muted); 
    bgm.play().catch(e => console.error("BGM play failed:", e));

    gameState = 'playing';
    loop();
}
function resetGameData() {
    bgm.pause();

    player.x = canvas.width/2; player.y = canvas.height - 50;
    player.hp = 100; player.maxHp = 100;
    player.level = 1; player.xp = 0; player.nextLevelXp = 10;
    player.bulletCount = 1; player.fireRate = 20;
    player.damage = 15; player.bulletSize = 3; player.spread = 0.1; player.pierce = 0;
    player.bulletSpeed = 5; player.agility = 0.2; player.xpGainMultiplier = 1.0; player.critChance = 0.05; player.critDamage = 1.5;
    player.doctrine = null; player.doctrineKillCount = 0;
    player.hasInversionPulse = false; player.hasExplosionEnlarge = false; player.shotCount = 0;
    player.nextExplosiveShot = Math.floor(3 + Math.random() * 8);
    bullets = []; enemies = []; particles = []; xpGems = []; enemyBullets = [];
    score = 0; frameCount = 0; gameTimeDifficulty = 0;
    isTutorialMode = false;
    tutorialStep = 0;
    tutorialTimer = 0;
    // ボス関連リセット
    isBossActive = false; bossDefeatedCount = 0; timeToNextBoss = 60 * 60; bossWarningTimer = 0;
    pulseTimer = 0; nextPulseTime = 0;
    resetBossEffects();
    updateUI();
}

// ボス戦エフェクトの切り替え
function setBossEffects(active) {
    const container = document.getElementById('gameContainer');
    const warning = document.getElementById('bossWarning');
    if (active) {
        canvas.style.backgroundColor = '#111'; // 少し明るい黒
        container.style.setProperty('--glow-color', 'rgba(255, 255, 255, 0.3)');
        warning.style.display = 'none'; // 警告は消す
        triggerScreenShake(15, 60);
    } else {
        canvas.style.backgroundColor = '#000';
        container.style.setProperty('--glow-color', 'rgba(0, 255, 255, 0.2)');
        warning.style.display = 'none';
    }
}
function resetBossEffects() { setBossEffects(false); }


function loop() {
    if (gameState !== 'playing') return;
    requestAnimationFrame(loop);

    ctx.save();
    updateScreenShake();

    // 背景色もボス戦かどうかで変える
    ctx.fillStyle = isBossActive ? '#111' : '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (hitStopTimer > 0) {
        hitStopTimer--;
    } else {
        updateGameLogic();
        updateTutorial();
    }
    drawGame();
    drawShockwaves();
    
    // 画面反転演出 (描画の最後に適用)
    if (screenInvertTimer > 0 || pulseTimer > 0) {
        ctx.globalCompositeOperation = 'difference';
        ctx.fillStyle = 'white';
        ctx.fillRect(-50, -50, canvas.width + 100, canvas.height + 100);
        ctx.globalCompositeOperation = 'source-over';
        if (screenInvertTimer > 0) screenInvertTimer--;
    }

    ctx.restore();
    
    frameCount++;
    if (frameCount % 60 === 0) gameTimeDifficulty++;
}

function updateGameLogic() {
    // Keyboard input
    if (keys.w) input.y -= 5;
    if (keys.a) input.x -= 5;
    if (keys.s) input.y += 5;
    if (keys.d) input.x += 5;

    // Gamepad input
    const gamepads = navigator.getGamepads();
    if (gamepads[0]) {
        const gamepad = gamepads[0];
        const deadzone = 0.2;
        if (Math.abs(gamepad.axes[0]) > deadzone) {
            input.x += gamepad.axes[0] * 5;
        }
        if (Math.abs(gamepad.axes[1]) > deadzone) {
            input.y += gamepad.axes[1] * 5;
        }
    }

    // Clamp input to screen
    input.x = Math.max(0, Math.min(canvas.width, input.x));
    input.y = Math.max(0, Math.min(canvas.height, input.y));

    player.x += (input.x - player.x) * player.agility;
    player.y += (input.y - player.y) * player.agility;
    player.x = Math.max(player.w, Math.min(canvas.width - player.w, player.x));
    player.y = Math.max(player.h, Math.min(canvas.height - player.h, player.y));

    stars.forEach(star => {
        star.y += star.speed + (gameTimeDifficulty * 0.02);
        if(star.y > canvas.height) { star.y = 0; star.x = Math.random() * canvas.width; }
    });

    // --- 攻撃速度計算 (背水の陣) ---
    let effectiveFireRate = player.fireRate;
    if (player.doctrine === 'lastStand') {
        const hpRatio = player.hp / player.maxHp;
        effectiveFireRate = player.fireRate * (0.4 + 0.6 * hpRatio); // HP低で最大2.5倍速
    }
    if (frameCount % Math.max(1, Math.floor(effectiveFireRate)) === 0) spawnPlayerBullets();

    // --- 反転の衝動管理 ---
    if (!isBossActive && player.hasInversionPulse) {
        if (pulseTimer <= 0) {
            if (nextPulseTime === 0) {
                nextPulseTime = frameCount + 300 + Math.random() * 1200;
            }
            if (frameCount >= nextPulseTime) {
                pulseTimer = 900; // 15秒
                nextPulseTime = frameCount + 900 + 600 + Math.random() * 1800;
            }
        }
    }
    if (pulseTimer > 0) pulseTimer--;

    // --- ボス出現管理 ---
    if (!isBossActive) {
        timeToNextBoss--;
        if (timeToNextBoss <= 180 && timeToNextBoss > 0) { // 残り3秒で警告
             document.getElementById('bossWarning').style.display = 'block';
        }
        if (timeToNextBoss <= 0) {
            spawnBoss();
        }
        // ボスがいない時だけ雑魚スポーン
        const spawnRate = Math.max(15, 60 - gameTimeDifficulty * 0.6);
        if (frameCount % Math.floor(spawnRate) === 0) {
            if (!isTutorialMode) spawnEnemy();
        }
    }

    updateEntities();
    checkCollisions();
    updateUI();
    
    if (player.hp <= 0) {
        gameState = 'gameover';
        document.getElementById('finalScoreScore').innerText = "SCORE: " + score;
        document.getElementById('finalScoreBoss').innerText = "BOSS DEFEATED: " + bossDefeatedCount;
        document.getElementById('gameOverMenu').style.display = 'flex';
        resetBossEffects();
    }
}

function drawBossBackground() {
    const gridSize = 20;
    const speed = 0.5;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    
    // 描画負荷を少しでも下げるためにパスをまとめる
    ctx.beginPath();
    
    const offsetX = (frameCount * speed) % gridSize;
    for (let x = -offsetX; x < canvas.width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
    }
    
    const offsetY = (frameCount * speed * 1.5) % gridSize;
    for (let y = -offsetY; y < canvas.height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();
}

function drawPlayer(x, y, alpha = 1.0) {
    const w = player.w;
    const h = player.h;
    const color = getColor(player.baseColor, 'player');
    ctx.save();
    ctx.globalAlpha = alpha;

    // Rocket body
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 4, y - h / 4, w / 2, h / 2 + 2);
    
    // Nose cone
    ctx.beginPath();
    ctx.moveTo(x, y - h / 4 - 4);
    ctx.lineTo(x - w / 4, y - h / 4);
    ctx.lineTo(x + w / 4, y - h / 4);
    ctx.fill();
    
    // Side fins
    ctx.fillRect(x - w / 2, y + h / 4, w / 4, h / 4);
    ctx.fillRect(x + w / 4, y + h / 4, w / 4, h / 4);
    
    // Engine flame
    if (alpha > 0.5 && frameCount % 4 < 2) {
        ctx.fillStyle = '#f80';
        ctx.fillRect(x - 1, y + h / 2, 2, 3);
    }
    
    ctx.restore();
}

function drawGame() {
    // ボス戦かどうかで背景描画を切り替え
    if (isBossActive) {
        drawBossBackground();
    } else {
        stars.forEach(s => {
            ctx.fillStyle = getColor(s.baseColor, 'bg');
            ctx.fillRect(s.x, s.y, 1, 1);
        });
    }

    // プレイヤー
    drawPlayer(player.x, player.y);

    if (player.doctrine === 'shield') {
        const shieldCount = 2;
        for (let i = 0; i < shieldCount; i++) {
            const angle = (frameCount * 0.05) + (i * Math.PI * 2 / shieldCount);
            const sx = player.x + Math.cos(angle) * 30;
            const sy = player.y + Math.sin(angle) * 30;
            ctx.fillStyle = getColor('#0ff', 'player');
            ctx.fillRect(sx - 4, sy - 4, 8, 8);
        }
    }
    // 残像はボス戦中は表示しない（視認性のため）
    if (!isBossActive) {
        drawPlayer(player.x, player.y + 5, 0.3);
    }

    // プレイヤー弾
    ctx.fillStyle = getColor('#ffeb3b', 'pBullet');
    bullets.forEach(b => ctx.fillRect(b.x - b.size/2, b.y - b.size/2, b.size, b.size));

    // 敵弾
    ctx.fillStyle = getColor('#f0f', 'eBullet');
    enemyBullets.forEach(b => ctx.fillRect(b.x - 2, b.y - 2, 4, 4));

    // 敵とボス
    enemies.forEach(e => {
        // ボスか雑魚かで色タイプを変える
        const colorType = e.isBoss ? 'boss' : 'enemy';
        let drawColor = getColor(e.baseColor, colorType);
        
        // 突撃準備中の敵は色を点滅させる (ボス戦以外)
        if (!isBossActive && e.isCharger && e.chargeTimer > 0 && Math.floor(e.chargeTimer/10) % 2 === 0) {
             drawColor = '#fff'; // 点滅色
        }

        ctx.fillStyle = drawColor;
        if (e.isRare) {
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.w/2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillRect(e.x - e.w/2, e.y - e.h/2, e.w, e.h);
        }
        
        // 顔（ボス戦中は少し暗く）
        ctx.fillStyle = isBossActive ? '#333' : '#000';
        ctx.fillRect(e.x - e.w/5, e.y - e.h/4, e.w/12, e.h/4);
        ctx.fillRect(e.x + e.w/12, e.y - e.h/4, e.w/12, e.h/4);

        // レア敵（シルクハット）の追加装飾
        if (e.isRare) {
            ctx.fillStyle = isBossActive ? '#444' : '#333';
            // つば
            ctx.fillRect(e.x - e.w * 0.7, e.y - e.h * 0.5, e.w * 1.4, e.h * 0.15);
            // 山
            ctx.fillRect(e.x - e.w * 0.4, e.y - e.h * 1.0, e.w * 0.8, e.h * 0.6);
        }
        
        // --- タイミングコアの描画 ---
        if (e.isBoss && e.timingCore.state !== 'inactive' && e.timingCore.state !== 'cooldown') {
            const core = e.timingCore;
            ctx.beginPath();
            ctx.arc(core.x, core.y, core.radius, 0, Math.PI * 2);
            if (core.state === 'active') {
                ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + Math.sin(frameCount*0.5)*0.5})`;
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 3;
            } else { // charging
                ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.strokeStyle = `rgba(255, 255, 255, ${Math.floor(frameCount/5)%2 ? 0.8 : 0.3})`;
                ctx.lineWidth = 2;
            }
            ctx.fill();
            ctx.stroke();
        }

        // --- レーザーの描画 ---
        if (e.isBoss) {
            if (e.laserState === 'aiming') {
                ctx.beginPath();
                ctx.moveTo(e.x, e.y);
                ctx.lineTo(e.laserTargetX, e.laserTargetY);
                ctx.strokeStyle = `rgba(255, 255, 255, ${Math.floor(frameCount/3)%2 ? 0.5 : 0.2})`;
                ctx.lineWidth = 1;
                ctx.stroke();
            } else if (e.laserState === 'firing') {
                const dx = e.laserTargetX - e.x;
                const dy = e.laserTargetY - e.y;
                const len = Math.sqrt(dx*dx + dy*dy);
                const endX = e.x + (dx/len) * 1000;
                const endY = e.y + (dy/len) * 1000;

                ctx.beginPath();
                ctx.moveTo(e.x, e.y);
                ctx.lineTo(endX, endY);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.lineWidth = 8 + Math.sin(e.laserTimer * 0.2) * 6;
                ctx.stroke();
                // さらに中心線を足してコアっぽさを出す
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }
    });

    ctx.fillStyle = getColor('#0f0', 'xp');
    xpGems.forEach(g => ctx.fillRect(g.x - 2, g.y - 2, 4, 4));

    particles.forEach(p => {
        ctx.globalAlpha = p.life;
        if (p.isText) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px "M PLUS 1 Code"';
            ctx.fillText(p.text, p.x, p.y);
        } else {
            ctx.fillStyle = getColor(p.baseColor, 'particle');
            ctx.fillRect(p.x, p.y, p.size, p.size);
        }
    });
    ctx.globalAlpha = 1.0;

    // --- スラッシュエフェクトの描画 ---
    for (let i = slashes.length - 1; i >= 0; i--) {
        const s = slashes[i];
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4 * s.life;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
        s.life -= 0.05;
        if (s.life <= 0) slashes.splice(i, 1);
    }

    // --- Quick Tap (QTE) UIの描画 ---
    enemies.forEach(e => {
        if (e.isBoss && e.quickTap && e.quickTap.state === 'active') {
            const qte = e.quickTap;
            const progress = qte.timer / 100; // 1.0 -> 0
            
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(qte.x, qte.y, 10 + progress * 40, 0, Math.PI * 2);
            ctx.stroke();
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 16px "M PLUS 1 Code"';
            ctx.textAlign = 'center';
            ctx.fillText('TAP! or SPACE!', qte.x, qte.y + 6);
        }
    });

    // --- ボス戦時のビネットエフェクト ---
    if (isBossActive) {
        const vignetteStrength = 0.4 + Math.sin(frameCount * 0.03) * 0.3; // 0.1 to 0.7
        const gradient = ctx.createRadialGradient(
            canvas.width / 2, canvas.height / 2, canvas.width / 3, // inner circle
            canvas.width / 2, canvas.height / 2, canvas.width / 1.2  // outer circle
        );
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(1, `rgba(0, 0, 0, ${vignetteStrength})`);
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

function updateEntities() {
    const slowFactor = pulseTimer > 0 ? 0.5 : 1.0;
    enemies = enemies.filter(e => !e.dead);
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        
        if (player.doctrine === 'curve') {
            const angle = 0.04;
            const nx = b.vx * Math.cos(angle) - b.vy * Math.sin(angle);
            const ny = b.vx * Math.sin(angle) + b.vy * Math.cos(angle);
            b.vx = nx; b.vy = ny;
        }

        b.x += b.vx; b.y += b.vy;

        if (player.doctrine === 'reflect' && !b.reflected) {
            if (b.x < 0 || b.x > canvas.width) {
                b.vx *= -1; b.reflected = true;
            } else if (b.y < 0 || b.y > canvas.height) {
                b.vy *= -1; b.reflected = true;
            }
        }

        if (b.y < -50 || b.x < -50 || b.x > canvas.width + 50 || b.y > canvas.height + 50) bullets.splice(i, 1);
    }
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        let b = enemyBullets[i]; b.x += b.vx * slowFactor; b.y += b.vy * slowFactor;
        if (b.y > canvas.height + 10 || b.x < -10 || b.x > canvas.width + 10) enemyBullets.splice(i, 1);
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
        let e = enemies[i];
        if (e.dead) continue;
        
        if (e.isBoss) {
            // ボスの動き：ゆっくり降りてきて左右に動く
            if (e.y < 60) e.y += 0.5 * slowFactor;
            e.x += Math.sin(frameCount * 0.02) * 2 * slowFactor;

            // 新しいオーラエフェクト
            if (frameCount % 4 === 0) { // 頻度を調整
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.max(e.w, e.h) / 1.5; // オーラの広がりを調整
                particles.push({
                    x: e.x + Math.cos(angle) * radius * (0.5 + Math.random() * 0.5), 
                    y: e.y + Math.sin(angle) * radius * (0.5 + Math.random() * 0.5), 
                    vx: (Math.random() - 0.5) * 0.5, // 動きは控えめに
                    vy: (Math.random() - 0.5) * 0.5,
                    life: 0.5, // 短命
                    size: Math.random() * 2 + 1, 
                    baseColor: '#fff'
                });
            }

            // --- Quick Tap (QTE) Logic ---
            const qte = e.quickTap;
            if (qte) {
                qte.timer -= slowFactor;
                if (qte.timer <= 0) {
                    if (qte.state === 'inactive') {
                        qte.state = 'active';
                        qte.timer = 100; // 約1.6秒の猶予
                        qte.x = 40 + Math.random() * (canvas.width - 80);
                        qte.y = 80 + Math.random() * (canvas.height - 160);
                    } else if (qte.state === 'active') {
                        // 時間切れ
                        qte.state = 'cooldown';
                        qte.timer = 240 + Math.random() * 240;
                    } else {
                        // クールダウン終了
                        qte.state = 'inactive';
                        qte.timer = 180 + Math.random() * 180;
                    }
                }
            }

            // --- タイミングコアのロジック ---
            const core = e.timingCore;
            core.timer -= slowFactor;
            if (core.timer <= 0) {
                switch (core.state) {
                    case 'inactive':
                        core.state = 'charging';
                        core.timer = 120; // 2秒チャージ
                        core.x = e.x + (Math.random() - 0.5) * e.w * 0.5;
                        core.y = e.y + (Math.random() - 0.5) * e.h * 0.5;
                        break;
                    case 'charging':
                        core.state = 'active';
                        core.timer = 35; // 約0.58秒の攻撃チャンス
                        break;
                    case 'active': // 時間切れ
                        core.state = 'cooldown';
                        core.timer = 180; // 3秒クールダウン
                        // ペナルティ攻撃
                        for(let j=0; j<12; j++) {
                            let angle = Math.atan2(player.y - e.y, player.x - e.x) + (Math.random()-0.5)*0.5;
                            enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(angle)*5, vy: Math.sin(angle)*5 });
                        }
                        break;
                    case 'cooldown':
                        core.state = 'inactive';
                        core.timer = 120;
                        break;
                }
            }
            
            // --- スパイラル攻撃のロジック ---
            e.spiralAttack.timer -= slowFactor;
            if (e.spiralAttack.timer <= 0 && !e.spiralAttack.active) {
                e.spiralAttack.active = true;
                e.spiralAttack.timer = 180; // 3秒間攻撃
            }
            if (e.spiralAttack.active) {
                if (e.spiralAttack.timer <= 0) {
                    e.spiralAttack.active = false;
                    e.spiralAttack.timer = 400; // 6.6秒クールダウン
                } else {
                    if (frameCount % 3 === 0) {
                       const speed = 2.5;
                       for(let i = 0; i < 2; i++) { // 2方向に出す
                           const angle = e.spiralAttack.angle + Math.PI * i;
                           enemyBullets.push({ 
                               x: e.x, y: e.y, 
                               vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed 
                           });
                       }
                       e.spiralAttack.angle += 0.2; // 少しずつ角度をずらす
                    }
                }
            }

            // --- レーザー攻撃のロジック ---
            e.laserTimer -= slowFactor;
            if (e.laserTimer <= 0 && e.laserState === 'idle') {
                e.laserState = 'aiming';
                e.laserTimer = 90; // 1.5秒エイミング
                e.laserTargetX = player.x;
                e.laserTargetY = player.y;
            } else if (e.laserState === 'aiming') {
                if (e.laserTimer <= 0) {
                    e.laserState = 'firing';
                    e.laserTimer = 120; // 2秒間発射
                }
            } else if (e.laserState === 'firing') {
                // レーザー発射中にパーティクルを発生させて迫力を出す
                const lerpAmount = Math.random();
                createParticles(
                    e.x + (e.laserTargetX - e.x) * lerpAmount,
                    e.y + (e.laserTargetY - e.y) * lerpAmount,
                    '#fff', 2
                );
                if (e.laserTimer <= 0) {
                    e.laserState = 'idle';
                    e.laserTimer = 300; // 5秒クールダウン
                }
            }

            // ボスの攻撃パターン（インフレする）
            const effectiveBossFireRate = Math.floor(e.fireRate / slowFactor);
            if (frameCount % effectiveBossFireRate === 0) {
                createParticles(e.x, e.y, '#fff', 5); // 弾発射時にもエフェクト
                // 放射状攻撃
                const ways = 8 + bossDefeatedCount * 2;
                for(let j=0; j<ways; j++) {
                    let angle = (Math.PI * 2 / ways) * j + frameCount*0.01;
                    enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(angle)*3, vy: Math.sin(angle)*3 });
                }
                // プレイヤー狙い撃ちも混ぜる
                if (bossDefeatedCount > 1) {
                     let angle = Math.atan2(player.y - e.y, player.x - e.x);
                     enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(angle)*4, vy: Math.sin(angle)*4 });
                }
            }
        } else if (e.isCharger) {
            // 反射神経要素：突撃タイプの敵
            if (e.chargeTimer > 0) {
                e.chargeTimer -= slowFactor; // 溜め中
                e.y += 0.5 * slowFactor; // 少しずつ降りる
            } else {
                // 突撃開始！
                e.y += e.speed * 5 * slowFactor; // 通常の5倍速
            }
        } else {
            // 通常の敵
            e.y += e.speed * slowFactor;
            e.x += Math.sin(frameCount * 0.05 + e.offset) * e.sway * slowFactor;
            const effectiveEnemyFireRate = Math.floor(e.fireRate / slowFactor);
            if (frameCount % effectiveEnemyFireRate === 0 && e.y < canvas.height - 50) {
                let angle = Math.atan2(player.y - e.y, player.x - e.x);
                enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(angle) * 2, vy: Math.sin(angle) * 2 });
            }
        }

        if (e.y > canvas.height + 50) enemies.splice(i, 1);
    }

    for (let i = xpGems.length - 1; i >= 0; i--) {
        let g = xpGems[i]; g.y += 1 * slowFactor;
        let dx = player.x - g.x, dy = player.y - g.y;
        if (Math.sqrt(dx*dx + dy*dy) < 50) { g.x += dx * 0.15 * slowFactor; g.y += dy * 0.15 * slowFactor; }
        if (g.y > canvas.height) xpGems.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i]; p.x += p.vx; p.y += p.vy; p.life -= 0.05;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function checkCollisions() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (e.dead) continue;
            if (!b.dead && rectIntersect(b.x, b.y, b.size, e.x, e.y, e.w, e.h)) {
                let finalDamage = player.damage;
                let isCritical = false;
                let effectiveCritChance = player.critChance;
                if (player.doctrine === 'lastStand') {
                    const hpRatio = player.hp / player.maxHp;
                    effectiveCritChance = player.critChance + (1.0 - hpRatio) * 0.4; // HPが低いほど最大+40%
                }
                if (Math.random() < effectiveCritChance) {
                    finalDamage *= player.critDamage;
                    isCritical = true;
                }
                e.hp -= finalDamage;

                if (isCritical) {
                    createParticles(e.x, e.y, '#ffeb3b', 15); // クリティカルヒットエフェクト
                    triggerHitStop(3);
                } else {
                    createParticles(e.x, e.y, isBossActive ? '#fff' : e.baseColor, 2);
                }
                
                if (b.isExplosive) {
                    triggerShockwave(b.x, b.y);
                    createParticles(b.x, b.y, '#ffeb3b', 15);
                    triggerScreenShake(3, 5);
                    // AOE Damage
                    for (let k = enemies.length - 1; k >= 0; k--) {
                        const otherE = enemies[k];
                        if (otherE.dead) continue;
                        const dx = otherE.x - b.x;
                        const dy = otherE.y - b.y;
                        if (Math.sqrt(dx*dx + dy*dy) < 40) {
                            otherE.hp -= player.damage * 0.5;
                            if (otherE.hp <= 0) killEnemy(otherE);
                        }
                    }
                    b.dead = true;
                }

                if (b.pierce <= 0) b.dead = true; else b.pierce--;
                if (e.hp <= 0) killEnemy(e);
            }
        }
    }
    bullets = bullets.filter(b => !b.dead);

    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (e.dead) continue;
        if (rectIntersect(player.x, player.y, 4, e.x, e.y, e.w, e.h)) hit = true;

        if (player.doctrine === 'shield') {
            const shieldCount = 2;
            for (let i = 0; i < shieldCount; i++) {
                const angle = (frameCount * 0.05) + (i * Math.PI * 2 / shieldCount);
                const sx = player.x + Math.cos(angle) * 30;
                const sy = player.y + Math.sin(angle) * 30;
                if (rectIntersect(sx, sy, 8, e.x, e.y, e.w, e.h)) {
                    e.hp -= player.damage * 0.1;
                    if (e.hp <= 0) killEnemy(e);
                }
            }
        }
        
        // --- タイミングコアとの当たり判定 ---
        if (e.isBoss && e.timingCore.state === 'active') {
            const core = e.timingCore;
            const dx = player.x - core.x;
            const dy = player.y - core.y;
            if (Math.sqrt(dx*dx + dy*dy) < player.w/2 + core.radius) {
                // 成功！
                e.hp -= 500 * (bossDefeatedCount + 1);
                e.timingCoreSuccess = true; // For tutorial
                core.state = 'cooldown';
                core.timer = 240; // 4秒の長めのクールダウン
                triggerScreenShake(10, 30);
                triggerHitStop(15);
                triggerShockwave(core.x, core.y);
                createParticles(core.x, core.y, '#fff', 30);
                // 成功したのでペナルティ攻撃はなし
            }
        }
        
        // --- レーザーとの当たり判定 ---
        if (e.isBoss && e.laserState === 'firing') {
            // 点と線の距離で簡易的に判定
            const A = e.laserTargetY - e.y;
            const B = e.x - e.laserTargetX;
            const C = -A * e.x - B * e.y;
            const dist = Math.abs(A * player.x + B * player.y + C) / Math.sqrt(A * A + B * B);
            if (dist < player.w/2 + 2) { // 2はレーザーの幅の半分（おおよそ）
                hit = true;
            }
        }
    }
    for (let j = enemyBullets.length - 1; j >= 0; j--) {
        const b = enemyBullets[j];
        if (rectIntersect(player.x, player.y, 4, b.x, b.y, 4, 4)) {
            hit = true;
            enemyBullets.splice(j, 1);
            continue;
        }

        if (player.doctrine === 'shield') {
            const shieldCount = 2;
            let shielded = false;
            for (let i = 0; i < shieldCount; i++) {
                const angle = (frameCount * 0.05) + (i * Math.PI * 2 / shieldCount);
                const sx = player.x + Math.cos(angle) * 30;
                const sy = player.y + Math.sin(angle) * 30;
                if (rectIntersect(sx, sy, 8, b.x, b.y, 4, 4)) {
                    enemyBullets.splice(j, 1);
                    createParticles(sx, sy, '#fff', 2);
                    shielded = true;
                    break;
                }
            }
            if (shielded) continue;
        }
    }

    if (hit) {
        player.hp -= isBossActive ? 15 : 5; // ボス戦中は被ダメUP
        createParticles(player.x, player.y, '#f00', 5);
        if (player.hp < 0) player.hp = 0;
    }

    xpGems.forEach((g, i) => {
        if (rectIntersect(player.x, player.y, 20, g.x, g.y, 4, 4)) {
            addXp(g.val); xpGems.splice(i, 1);
        }
    });
}

// 中心座標での当たり判定に修正
function rectIntersect(x1, y1, s1, x2, y2, w2, h2) {
    return x2 - w2/2 < x1 + s1/2 && x2 + w2/2 > x1 - s1/2 &&
           y2 - h2/2 < y1 + s1/2 && y2 + h2/2 > y1 - s1/2;
}

function spawnPlayerBullets() {
    player.shotCount++;
    const count = player.bulletCount;
    let isExplosive = false;
    if (player.hasExplosionEnlarge && player.shotCount >= player.nextExplosiveShot) {
        isExplosive = true;
        player.nextExplosiveShot = player.shotCount + Math.floor(3 + Math.random() * 8);
    }
    
    for (let i = 0; i < count; i++) {
        let angleOffset = (i - (count - 1) / 2) * player.spread;
        if (count > 30) angleOffset += (Math.random() - 0.5) * 0.5;
        let angle = -Math.PI / 2 + angleOffset; 
        bullets.push({
            x: player.x, y: player.y,
            vx: Math.cos(angle) * player.bulletSpeed, vy: Math.sin(angle) * player.bulletSpeed,
            size: isExplosive ? player.bulletSize * 2 : player.bulletSize, 
            pierce: player.pierce, dead: false,
            reflected: false,
            isExplosive: isExplosive
        });
    }
}

// プレイヤーの総合的な強さを計算する関数
function calculatePlayerPowerLevel() {
    // DPS (Damage Per Second) を基準に計算
    const bulletsPerSecond = 60 / player.fireRate;
    // クリティカルヒットによるダメージ期待値を計算に含める
    const critMultiplier = 1 + (player.critChance * (player.critDamage - 1));
    const dps = player.damage * player.bulletCount * bulletsPerSecond * critMultiplier;

    // 貫通性能も加味
    const pierceMultiplier = 1 + (player.pierce * 0.5);
    
    // 弾速も攻撃性能として少し加味（速い弾は当たりやすい）
    const bulletSpeedMultiplier = 1 + (player.bulletSpeed - 5) * 0.02; // 基準値5からの増加分を評価

    const offensivePower = dps * pierceMultiplier * bulletSpeedMultiplier;

    // 生存性（HPと回避能力）も影響させる
    // Agilityの価値をHP換算で評価。基本値0.2で元の計算式とおおよそ同等になるように調整
    const defensivePower = player.maxHp * (1.5 + player.agility * 2.5);

    const powerLevel = offensivePower + defensivePower;

    // ゲームバランスのために数値を調整
    return powerLevel / 150; 
}

// ボススポーン関数
function spawnBoss() {
    isBossActive = true;
    setBossEffects(true);

    // 既存の敵と弾を一掃
    enemies = []; enemyBullets = [];

    const powerLevel = calculatePlayerPowerLevel();
    // プレイヤーのパワーレベルに基づいてボスを強化
    // 最低限の強さは保証しつつ、青天井に強くなるように調整. 係数を増やしてよりチャレンジングに
    const hpMultiplier = 1 + (bossDefeatedCount * 0.2) + powerLevel * 0.6;
    const sizeMultiplier = 1 + (bossDefeatedCount * 0.1) + (powerLevel / 10); // 15から10へ
    const attackMultiplier = 1 + (bossDefeatedCount * 0.2) + (powerLevel / 7); // 10から7へ

    enemies.push({
        x: canvas.width / 2, y: -50,
        w: Math.min(120, 50 * sizeMultiplier), // サイズ上限
        h: Math.min(120, 50 * sizeMultiplier),
        hp: 1500 * hpMultiplier,
        fireRate: Math.max(5, 30 / attackMultiplier), // 連射速度上限
        baseColor: '#fff', // ボスは白ベース
        isBoss: true,

       timingCore: {
            state: 'inactive', // 'inactive', 'charging', 'active', 'cooldown'
            timer: 180, // 次のアクションまでの時間
            x: canvas.width / 2, // 初期位置
            y: 100,
            radius: 15
        },
        // レーザー攻撃用のプロパティ
        laserState: 'idle', // 'idle', 'aiming', 'firing'
        laserTimer: 240,
        laserTargetX: 0,
        laserTargetY: 0,
        // 新しいスパイラル攻撃用のプロパティ
        spiralAttack: {
            timer: 150, // 開始までの時間
            angle: 0,
            active: false
        },
        // Quick Tap (QTE) 用のプロパティ
        quickTap: {
            state: 'inactive', // 'inactive', 'active', 'cooldown'
            timer: 300 + Math.random() * 300,
            x: 0,
            y: 0,
            radius: 40
        }
    });
}

function spawnEnemy() {
    const diff = 1 + (gameTimeDifficulty * 0.15);
    // 10%の確率で「突撃タイプ（反射神経要素）」をスポーン
    const isCharger = Math.random() < 0.1 + (gameTimeDifficulty * 0.005);
    // 3%の確率でレア敵（シルクハット）をスポーン (突撃タイプではない場合)
    const isRare = !isCharger && Math.random() < 0.03;
    
    let w = 16 + Math.random()*10;
    let h = 16 + Math.random()*10;
    let hp = (isCharger ? 5 : 10) * diff;
    let baseColor = isCharger ? '#f00' : `hsl(${Math.random()*360}, 70%, 50%)`;

    if (isRare) {
        w = 18; h = 18; // 以前より少し小さめに調整
        hp = 100 * diff; // HP多め
        baseColor = '#AA00AA';
    }

    enemies.push({
        x: Math.random() * (canvas.width - 20) + 10, y: -20,
        w: w, h: h,
        hp: hp,
        speed: 1 + Math.random() + (gameTimeDifficulty * 0.02),
        sway: Math.random() * 2, offset: Math.random() * 100,
        fireRate: Math.max(30, 120 - gameTimeDifficulty),
        baseColor: baseColor,
        isCharger: isCharger,
        isRare: isRare,
        chargeTimer: isCharger ? 90 : 0 // 90フレーム(1.5秒)溜める
    });
}

function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    
    if (player.doctrine === 'heal') {
        player.doctrineKillCount++;
        if (player.doctrineKillCount >= 5) {
            player.doctrineKillCount = 0;
            const healAmount = (player.maxHp - player.hp) / 2;
            player.hp += healAmount;
            createParticles(player.x, player.y, '#0f0', 15);
            particles.push({
                x: player.x, y: player.y - 20,
                vx: 0, vy: -1,
                life: 1.0, size: 0, baseColor: '#0f0', isText: true, text: 'HEAL!'
            });
        }
    }

    if (e.isBoss) {
        // ボス撃破時処理
        isBossActive = false;
        bossDefeatedCount++;
        timeToNextBoss = 60 * 60; // タイマーリセット
        setBossEffects(false); // 色を戻す
        // 大量のXP
        for(let i=0; i<20; i++) xpGems.push({x: e.x+(Math.random()-0.5)*e.w, y: e.y+(Math.random()-0.5)*e.h, val: 50});
        score += 5000 * (bossDefeatedCount + 1);
        createParticles(e.x, e.y, '#fff', 50); // 派手な爆発
    } else {
        createParticles(e.x, e.y, isBossActive ? '#fff' : e.baseColor, 10);
        score += 100;
        xpGems.push({ x: e.x, y: e.y, val: 5 + (gameTimeDifficulty * 0.8) });
    }
}

function createParticles(x, y, color, count) {
    for(let i=0; i<count; i++) {
        particles.push({
            x: x, y: y, vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5,
            life: 1.0, size: Math.random() * 3 + 1, baseColor: color
        });
    }
}

function addXp(amount) {
    player.xp += amount * player.xpGainMultiplier;
    if (player.xp >= player.nextLevelXp) {
        player.xp -= player.nextLevelXp;
        player.level++;
        player.nextLevelXp = Math.floor(player.nextLevelXp * 1.25 + 20);
        showUpgradeMenu();
    }
}

function showUpgradeMenu() {
    gameState = 'upgrade';
    const menu = document.getElementById('upgradeMenu');
    const container = document.getElementById('cardsContainer');
    container.innerHTML = '';
    menu.style.display = 'flex';
    updateDoctrinesUI();

    // Pick 3 unique upgrades
    const pool = [...upgradePool];
    for(let i=0; i<3; i++) {
        if (pool.length === 0) break;
        const idx = Math.floor(Math.random() * pool.length);
        const upg = pool.splice(idx, 1)[0];
        
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `<h3>${upg.name}</h3><p>${upg.desc}</p>`;
        card.onclick = () => { upg.apply(); menu.style.display = 'none'; gameState = 'playing'; loop(); };
        container.appendChild(card);
    }

    const rerollBtn = document.getElementById('rerollButton');
    rerollBtn.innerText = `REROLL (COST: ${rerollCost})`;
    rerollBtn.onclick = () => {
        if (score >= rerollCost) {
            score -= rerollCost;
            updateUI();
            showUpgradeMenu();
        }
    };
    rerollBtn.disabled = score < rerollCost;
}

function togglePause() {
    if (gameState === 'playing') {
        gameState = 'paused';
        document.getElementById('pauseMenu').style.display = 'flex';
    } else if (gameState === 'paused') {
        resumeGame();
    }
}

function resumeGame() {
    gameState = 'playing';
    document.getElementById('pauseMenu').style.display = 'none';
    loop();
}

function updateDoctrinesUI() {
    const container = document.getElementById('doctrinesContainer');
    container.innerHTML = '<div style="font-size: 10px; color: #0ff; margin-bottom: 5px;">DOCTRINES</div>';
    
    doctrinePool.forEach(doc => {
        const div = document.createElement('div');
        div.className = 'doctrine-card' + (player.doctrine === doc.id ? ' active' : '');
        div.innerHTML = `<h4>${doc.name}</h4><p>${doc.desc}</p><div style="color: #ffeb3b; font-size: 8px; margin-top: 2px;">${doctrineCost}</div>`;
        div.onclick = (e) => {
            e.stopPropagation();
            buyDoctrine(doc.id);
        };
        container.appendChild(div);
    });
}

function buyDoctrine(id) {
    if (score >= doctrineCost) {
        score -= doctrineCost;
        player.doctrine = id;
        player.doctrineKillCount = 0;
        updateUI();
        updateDoctrinesUI();
    }
}

// --- エフェクト関数群 ---
function triggerScreenShake(magnitude, duration) {
    screenShake.magnitude = magnitude;
    screenShake.duration = duration;
}
function updateScreenShake() {
    if (screenShake.duration > 0) {
        screenShake.duration--;
        const sx = (Math.random() - 0.5) * screenShake.magnitude;
        const sy = (Math.random() - 0.5) * screenShake.magnitude;
        ctx.translate(sx, sy);
    }
}
function triggerHitStop(duration) {
    hitStopTimer = duration;
}
function triggerShockwave(x, y) {
    shockwaves.push({ x, y, radius: 0, alpha: 1 });
}
function triggerSlash(x1, y1, x2, y2) {
    slashes.push({ x1, y1, x2, y2, life: 1.0 });
}
function drawShockwaves() {
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i];
        sw.radius += 4;
        sw.alpha -= 0.025;
        if (sw.alpha <= 0) {
            shockwaves.splice(i, 1);
        } else {
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${sw.alpha})`;
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }
}

function updateTutorial() {
    if (!isTutorialMode) {
        document.getElementById('tutorialOverlay').style.display = 'none';
        return;
    }

    const overlay = document.getElementById('tutorialOverlay');
    const msgBox = document.getElementById('tutorialMessage');
    
    if (tutorialStep < tutorialSteps.length) {
        overlay.style.display = 'block';
        const step = tutorialSteps[tutorialStep];
        msgBox.innerText = step.message;

        if (step.check()) {
            tutorialStep++;
            tutorialTimer = 0;
            if (tutorialStep < tutorialSteps.length && tutorialSteps[tutorialStep].action) {
                tutorialSteps[tutorialStep].action();
            }
        }
    } else {
        // Tutorial finished
        tutorialTimer++;
        if (tutorialTimer > 180) { // 3 seconds after last step
            isTutorialMode = false;
            timeToNextBoss = 60 * 60; // Reset boss timer to normal
            overlay.style.display = 'none';
        }
    }
}

function updateUI() {
    document.getElementById('scoreDisplay').innerText = `SCORE: ${score}`;
    document.getElementById('hpDisplay').innerText = `HP: ${Math.floor(player.hp)}/${player.maxHp}`;
    
    const xpPercent = Math.floor((player.xp / player.nextLevelXp) * 100);
    document.getElementById('levelDisplay').innerText = `LV: ${player.level} (${xpPercent}%)`;
    
    const critChance = Math.round(player.critChance * 100);
    document.getElementById('critDisplay').innerText = `CRIT: ${critChance}% (x${player.critDamage.toFixed(1)})`;

    // ボスまでの残り時間を秒で表示
    const secondsToBoss = Math.max(0, Math.ceil(timeToNextBoss / 60));
    document.getElementById('bossTimerDisplay').innerText = isBossActive ? "BOSS FIGHT!" : `NEXT BOSS: ${secondsToBoss}`;
    document.getElementById('bossTimerDisplay').style.color = (timeToNextBoss < 180 && !isBossActive) ? '#f00' : '#fff';
}

// --- 音量管理 ---
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');
const muteButton = document.getElementById('muteButton');

function updateVolume(volume, muted) {
    // グローバル変数と実際のaudioオブジェクトの両方を更新
    bgmVolume = volume;
    bgm.volume = bgmVolume;
    bgm.muted = muted;

    // UIの更新
    volumeSlider.value = bgmVolume;
    volumeValue.innerText = `${Math.round(bgmVolume * 100)}%`;
    volumeSlider.disabled = bgm.muted;
    muteButton.innerText = bgm.muted ? 'UNMUTE' : 'MUTE';
}

volumeSlider.addEventListener('input', e => {
    // スライダーを動かしたらミュートは解除する
    const newVolume = parseFloat(e.target.value);
    updateVolume(newVolume, false);
});

muteButton.addEventListener('click', () => {
    // ミュート状態をトグルする
    updateVolume(bgmVolume, !bgm.muted);
});

// 初期UI状態を設定
updateVolume(parseFloat(volumeSlider.value), false);

window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tutorial') === 'true') {
        startGame(true);
    }
});

// --- コマンダー（スタート画面のキャラクター）の描画ロジック ---
let commanderState = {
    x: 30, y: 40, radius: 15, color: '#AA00AA',
    recoil: 0, mouseX: 60, mouseY: 20, panic: false
};

function drawCommander() {
    const c = document.getElementById('commanderCanvas');
    if (!c) return;
    const cc = c.getContext('2d');
    cc.clearRect(0, 0, c.width, c.height);

    // 反動の減衰
    commanderState.recoil *= 0.85;
    if (Math.random() < 0.01) {
        commanderState.recoil = 5;
        commanderState.panic = true;
        setTimeout(() => { commanderState.panic = false; }, 500);
    }

    const cx = commanderState.x;
    const cy = commanderState.y;

    // 体（円形）
    cc.fillStyle = commanderState.color;
    cc.beginPath();
    cc.arc(cx, cy, commanderState.radius, 0, Math.PI * 2);
    cc.fill();

    // 目（ゲームのスタイルに合わせる）
    cc.fillStyle = '#000';
    cc.fillRect(cx - 5, cy - 3, 2, 5);
    cc.fillRect(cx + 3, cy - 3, 2, 5);

    // 銃
    const angle = Math.atan2(commanderState.mouseY - cy, commanderState.mouseX - cx);
    cc.save();
    cc.translate(cx, cy);
    cc.rotate(angle);
    cc.fillStyle = '#333';
    cc.fillRect(10 - commanderState.recoil, -2, 15, 4);
    cc.restore();

    // シルクハット
    cc.fillStyle = '#595959';
    cc.fillRect(cx - 15, cy - 10 - commanderState.recoil * 0.5, 30, 6);
    cc.fillRect(cx - 9, cy - 28 - commanderState.recoil * 0.5, 18, 18);

    // パニック時の「！」マーク
    if (commanderState.panic) {
        cc.fillStyle = 'white';
        cc.font = 'bold 12px Arial';
        cc.fillText('!', cx - 2, cy - 25);
    }

    if (gameState === 'start') {
        requestAnimationFrame(drawCommander);
    }
}

document.getElementById('startMenu').addEventListener('mousemove', (e) => {
    const c = document.getElementById('commanderCanvas');
    if (!c) return;
    const rect = c.getBoundingClientRect();
    commanderState.mouseX = e.clientX - rect.left;
    commanderState.mouseY = e.clientY - rect.top;
});

document.getElementById('startMenu').addEventListener('touchmove', (e) => {
    const c = document.getElementById('commanderCanvas');
    if (!c) return;
    const rect = c.getBoundingClientRect();
    commanderState.mouseX = e.touches[0].clientX - rect.left;
    commanderState.mouseY = e.touches[0].clientY - rect.top;
});

// 初期描画開始
drawCommander();

document.getElementById('startMenu').style.display = 'flex';
