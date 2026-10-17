
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const W = canvas.width;
const H = canvas.height;
const $ = id => document.getElementById(id);

const scoreEl = $("score");
const livesEl = $("lives");
const levelEl = $("level");
const bestEl = $("best");
const overlay = $("overlay");
const overlayTitle = $("overlayTitle");
const overlayText = $("overlayText");
const startBtn = $("startBtn");
const menuBest = $("menuBest");
const powerStatus = $("powerStatus");

const BEST_KEY = "blueHourMidnightBest";

let score = 0;
let lives = 3;
let level = 1;
let best = Number(localStorage.getItem(BEST_KEY)) || 0;

let running = false;
let paused = false;
let elapsed = 0;
let lastTime = 0;
let animationId = 0;

let spawnTimer = 0;
let flowerTimer = 0;
let butterflyTimer = 0;
let screenShake = 0;
let damageFlash = 0;

let currentPower = null;
let powerShield = 0;
let powerSlow = 0;
let powerCooldown = 0;

let flowers = [];
let moths = [];
let bullets = [];
let enemyBullets = [];
let particles = [];
let keys = {};

const random = (min, max) => Math.random() * (max - min) + min;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const powers = {
    shield: { name: "Escudo Lunar", color: "#8ad7ff" },
    nova: { name: "Explosão Astral", color: "#f7a7d8" },
    slow: { name: "Tempo Congelado", color: "#c7b7ff" },
    heal: { name: "Luz da Lua", color: "#ffe29a" }
};

const player = {
    x: W / 2,
    y: H - 70,
    radius: 12,
    speed: 225,
    invulnerable: 0,
    dashTime: 0,
    dashCooldown: 0,
    dashX: 0,
    dashY: -1,
    shootTimer: 0
};

const stars = Array.from({ length: 120 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    radius: random(0.4, 1.6),
    alpha: random(0.25, 0.8),
    phase: random(0, Math.PI * 2),
    speed: random(0.5, 1.8)
}));

// ==================================================
// ÁUDIO
// ==================================================

let audioContext = null;
let masterVolume = null;
let reverb = null;
let reverbGain = null;
let audioReady = false;

function initAudio() {
    try {
        if (!audioContext) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;

            if (!AudioCtx) {
                console.warn("Este navegador não suporta Web Audio API.");
                return;
            }

            audioContext = new AudioCtx();

            masterVolume = audioContext.createGain();
            masterVolume.gain.value = 0.65;
            masterVolume.connect(audioContext.destination);

            // Criar reverberação suave.
            const length = Math.floor(audioContext.sampleRate * 2.5);
            const impulse = audioContext.createBuffer(
                2,
                length,
                audioContext.sampleRate
            );

            for (let channel = 0; channel < 2; channel++) {
                const data = impulse.getChannelData(channel);

                for (let i = 0; i < length; i++) {
                    const fade = Math.pow(1 - i / length, 3.5);
                    data[i] = (Math.random() * 2 - 1) * fade;
                }
            }

            reverb = audioContext.createConvolver();
            reverb.buffer = impulse;

            reverbGain = audioContext.createGain();
            reverbGain.gain.value = 0.24;

            reverb.connect(reverbGain);
            reverbGain.connect(masterVolume);
        }

        if (audioContext.state === "suspended") {
            audioContext.resume();
        }

        audioReady = true;
    } catch (error) {
        console.error("Não foi possível iniciar o áudio:", error);
    }
}

function playNote(
    frequency,
    duration,
    volume = 0.05,
    delay = 0,
    type = "triangle"
) {
    if (!audioContext || !audioReady) return;

    try {
        const now = audioContext.currentTime + delay;

        const oscillator = audioContext.createOscillator();
        const filter = audioContext.createBiquadFilter();
        const envelope = audioContext.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, now);

        filter.type = "lowpass";
        filter.frequency.setValueAtTime(1400, now);
        filter.frequency.exponentialRampToValueAtTime(
            450,
            now + duration
        );
        filter.Q.value = 0.5;

        envelope.gain.setValueAtTime(0.0001, now);
        envelope.gain.linearRampToValueAtTime(
            volume,
            now + Math.min(0.06, duration * 0.25)
        );
        envelope.gain.exponentialRampToValueAtTime(
            0.0001,
            now + duration
        );

        oscillator.connect(filter);
        filter.connect(envelope);

        envelope.connect(masterVolume);

        if (reverb) {
            envelope.connect(reverb);
        }

        oscillator.start(now);
        oscillator.stop(now + duration + 0.05);

        oscillator.onended = () => {
            oscillator.disconnect();
            filter.disconnect();
            envelope.disconnect();
        };
    } catch (error) {
        console.warn("Erro ao reproduzir efeito sonoro:", error);
    }
}

// Som delicado para cada disparo.
function playShotSound() {
    playNote(392, 0.16, 0.022, 0, "triangle");
    playNote(587.33, 0.24, 0.009, 0.025, "sine");
}

// Som melancólico ao derrotar um inimigo comum.
function playEnemyDeathSound() {
    playNote(493.88, 0.45, 0.035, 0, "triangle");
    playNote(587.33, 0.60, 0.027, 0.11, "sine");
    playNote(440, 0.70, 0.020, 0.24, "triangle");
}

// Som longo e cinematográfico ao derrotar um chefe.
function playBossDeathSound() {
    playNote(174.61, 1.8, 0.055, 0, "triangle");
    playNote(261.63, 2.0, 0.045, 0.08, "sine");
    playNote(349.23, 2.2, 0.035, 0.18, "triangle");

    playNote(523.25, 1.4, 0.035, 0.35, "sine");
    playNote(466.16, 1.6, 0.030, 0.75, "triangle");
    playNote(392, 2.0, 0.025, 1.15, "sine");
    playNote(349.23, 2.4, 0.022, 1.65, "triangle");
}

// ==================================================
// INTERFACE
// ==================================================

function updateHUD() {
    if (scoreEl) scoreEl.textContent = String(score).padStart(2, "0");
    if (livesEl) livesEl.textContent = lives > 0 ? Array(lives).fill("♥").join(" ") : "♡";
    if (levelEl) levelEl.textContent = String(level).padStart(2, "0");
    if (bestEl) bestEl.textContent = best;
    if (menuBest) menuBest.textContent = best;

    updatePowerDisplay();
}

function updatePowerDisplay() {
    if (!powerStatus) return;

    if (currentPower && powers[currentPower]) {
        powerStatus.textContent = `E — ${powers[currentPower].name}`;
        powerStatus.style.color = powers[currentPower].color;
    } else {
        powerStatus.textContent = "Nenhum poder — colete uma borboleta";
        powerStatus.style.color = "";
    }
}

function showOverlay(title, message, buttonText) {
    if (!overlay) return;

    if (overlayTitle) overlayTitle.textContent = title;
    if (overlayText) overlayText.textContent = message;
    if (startBtn) startBtn.textContent = buttonText;

    overlay.classList.remove("hidden");
}

function hideOverlay() {
    if (overlay) overlay.classList.add("hidden");
}

// ==================================================
// INÍCIO E PAUSA
// ==================================================

function resetGame() {
    score = 0;
    lives = 3;
    level = 1;
    elapsed = 0;

    spawnTimer = 1.2;
    flowerTimer = 1.5;
    butterflyTimer = 7;

    currentPower = null;
    powerShield = 0;
    powerSlow = 0;
    powerCooldown = 0;

    flowers = [];
    moths = [];
    bullets = [];
    enemyBullets = [];
    particles = [];

    player.x = W / 2;
    player.y = H - 70;
    player.invulnerable = 1.5;
    player.dashTime = 0;
    player.dashCooldown = 0;
    player.shootTimer = 0;

    screenShake = 0;
    damageFlash = 0;

    for (let i = 0; i < 5; i++) spawnFlower();
    for (let i = 0; i < 3; i++) spawnMoth();

    updateHUD();
}

function startGame() {
    // IMPORTANTE: iniciar o áudio durante o clique do jogador.
    initAudio();

    cancelAnimationFrame(animationId);

    resetGame();

    running = true;
    paused = false;
    hideOverlay();

    lastTime = performance.now();
    animationId = requestAnimationFrame(gameLoop);
}

function finishGame() {
    running = false;
    paused = false;

    if (score > best) {
        best = score;

        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (error) {
            console.warn("Não foi possível salvar o recorde.", error);
        }
    }

    updateHUD();

    showOverlay(
        "The blue hour has faded.",
        `Você coletou ${score} pontos e chegou à fase ${level}. O jardim estará esperando quando você voltar.`,
        "Wander again"
    );
}

function togglePause() {
    if (!running) return;

    paused = !paused;

    if (paused) {
        cancelAnimationFrame(animationId);

        showOverlay(
            "A quiet moment",
            "O jardim espera por você. Quando estiver pronto, continue sua jornada.",
            "Continuar"
        );
    } else {
        hideOverlay();

        lastTime = performance.now();
        animationId = requestAnimationFrame(gameLoop);
    }
}

// ==================================================
// FLORES, BORBOLETAS E PARTÍCULAS
// ==================================================

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function spawnFlower() {
    if (flowers.length >= 9) return;

    flowers.push({
        x: random(30, W - 30),
        y: random(40, H - 45),
        radius: random(8, 11),
        phase: random(0, 6),
        rotation: random(0, 6),
        type: "normal",
        power: null,
        life: 18
    });
}

function spawnButterfly() {
    if (flowers.length >= 9) return;

    const types = ["shield", "nova", "slow", "heal"];
    const type = types[Math.floor(Math.random() * types.length)];

    flowers.push({
        x: random(30, W - 30),
        y: random(45, H - 55),
        radius: 13,
        phase: random(0, 6),
        rotation: random(0, 6),
        type: "butterfly",
        power: type,
        life: 14
    });
}

function createParticles(x, y, color, amount = 12) {
    for (let i = 0; i < amount; i++) {
        const angle = random(0, Math.PI * 2);
        const speed = random(25, 150);

        particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: random(0.3, 0.8),
            maxLife: 0.8,
            color,
            radius: random(1.5, 4)
        });
    }
}

function collectItems() {
    for (let i = flowers.length - 1; i >= 0; i--) {
        const item = flowers[i];

        if (distance(player, item) > player.radius + item.radius + 4) {
            continue;
        }

        if (item.power) {
            currentPower = item.power;

            createParticles(
                item.x,
                item.y,
                powers[item.power].color,
                20
            );

            flowers.splice(i, 1);
            updatePowerDisplay();
        } else {
            score += 10;

            createParticles(item.x, item.y, "#e8d4b4", 12);
            flowers.splice(i, 1);

            if (score > best) best = score;

            updateHUD();
        }
    }
}

function usePower() {
    if (!running || paused || !currentPower || powerCooldown > 0) return;

    const power = currentPower;

    currentPower = null;
    powerCooldown = 0.5;

    if (power === "shield") {
        powerShield = 5;
        player.invulnerable = Math.max(player.invulnerable, 5);

        createParticles(player.x, player.y, "#8ad7ff", 30);
    }

    if (power === "nova") {
        enemyBullets = [];

        for (let i = moths.length - 1; i >= 0; i--) {
            const moth = moths[i];

            if (moth.type === "boss") {
                moth.hp -= 8;

                if (moth.hp <= 0) {
                    defeatMoth(i);
                }
            } else {
                score += 10;
                createParticles(moth.x, moth.y, "#f7a7d8", 15);
                moths.splice(i, 1);
            }
        }

        createParticles(player.x, player.y, "#f7a7d8", 40);
        screenShake = 8;
    }

    if (power === "slow") {
        powerSlow = 6;

        createParticles(player.x, player.y, "#c7b7ff", 28);
    }

    if (power === "heal") {
        if (lives < 3) {
            lives++;
        } else {
            score += 25;
        }

        createParticles(player.x, player.y, "#ffe29a", 25);
    }

    updateHUD();
}

// ==================================================
// INIMIGOS E CHEFES
// ==================================================

function difficulty() {
    const timeFactor = Math.min(elapsed / 150, 1);
    const levelFactor = Math.max(0, level - 1);

    return {
        speed: 1 + timeFactor * 0.32 + levelFactor * 0.055,
        spawn: Math.max(0.48, 1.55 - timeFactor * 0.38 - levelFactor * 0.045),
        shooterChance: Math.min(0.30, 0.06 + levelFactor * 0.025),
        bulletSpeed: 1 + timeFactor * 0.18 + levelFactor * 0.025
    };
}

function spawnMoth() {
    const diff = difficulty();
    const roll = Math.random();

    let type = "moth";

    if (level >= 2 && roll < diff.shooterChance) {
        type = "shooter";
    } else if (level >= 3 && roll > 0.86) {
        type = "charger";
    }

    moths.push({
        x: random(25, W - 25),
        y: random(30, 115),
        radius: type === "charger" ? 15 : random(12, 16),
        vx: random(-1, 1),
        vy: random(-1, 1),
        phase: random(0, 6),
        speed: random(42, 63) * diff.speed,
        type,
        hp: type === "charger" ? 2 : 1,
        shootTimer: random(2.3, 3.6),
        age: 0
    });
}

function spawnBoss() {
    if (moths.some(moth => moth.type === "boss")) return;

    const hp = 18 + level * 2;

    moths.push({
        x: W / 2,
        y: 75,
        radius: 27,
        vx: 0,
        vy: 0,
        phase: 0,
        speed: 45,
        type: "boss",
        hp,
        maxHp: hp,
        shootTimer: 1.5,
        age: 0
    });

    createParticles(W / 2, 75, "#d2b1b0", 30);
    screenShake = 5;
}

function shootEnemy(moth, aimed = true) {
    const diff = difficulty();

    const angle = aimed
        ? Math.atan2(player.y - moth.y, player.x - moth.x)
        : Math.PI / 2;

    const speed = (moth.type === "boss" ? 135 : 95) * diff.bulletSpeed;

    enemyBullets.push({
        x: moth.x,
        y: moth.y + moth.radius / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: moth.type === "boss" ? 5.5 : 4.5,
        life: 6
    });
}

// ==================================================
// TIROS DO JOGADOR
// ==================================================

function shootPlayer() {
    if (moths.length === 0) return;

    let target = null;
    let nearest = Infinity;

    for (const moth of moths) {
        const d = distance(player, moth);

        if (d < nearest) {
            nearest = d;
            target = moth;
        }
    }

    if (!target) return;

    const angle = Math.atan2(
        target.y - player.y,
        target.x - player.x
    );

    // Velocidade alta para facilitar os acertos.
    const speed = 700;

    bullets.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 4,
        life: 1.7
    });

    // SOM DO TIRO: chamado ao disparar.
    playShotSound();
}

// ==================================================
// DERROTA DOS INIMIGOS
// ==================================================

function defeatMoth(index) {
    const moth = moths[index];
    if (!moth) return;

    const boss = moth.type === "boss";

    createParticles(
        moth.x,
        moth.y,
        boss ? "#d2b1b0" : "#d9dfe5",
        boss ? 38 : 14
    );

    // SOM DE MORTE: um efeito para inimigos e outro para chefes.
    if (boss) {
        playBossDeathSound();
    } else {
        playEnemyDeathSound();
    }

    score += boss ? 150 : 10;
    moths.splice(index, 1);

    if (boss) {
        spawnFlower();
        spawnFlower();
        screenShake = 8;
    }

    updateHUD();
}

// ==================================================
// ATUALIZAÇÃO DOS INIMIGOS
// ==================================================

function updateMoths(dt) {
    const diff = difficulty();
    const slow = powerSlow > 0 ? 0.43 : 1;

    for (let i = moths.length - 1; i >= 0; i--) {
        const moth = moths[i];

        moth.age += dt;
        moth.phase += dt * 2;

        if (moth.type === "boss") {
            moth.x = W / 2 + Math.sin(moth.age * 0.7) * W * 0.27;
            moth.y = 65 + Math.sin(moth.age * 1.5) * 10;

            moth.shootTimer -= dt;

            if (moth.shootTimer <= 0) {
                shootEnemy(moth, true);

                if (level >= 8) {
                    shootEnemy({ ...moth, x: moth.x - 18 }, false);
                    shootEnemy({ ...moth, x: moth.x + 18 }, false);
                }

                moth.shootTimer = Math.max(0.8, 1.8 - level * 0.04);
            }

            continue;
        }

        const dx = player.x - moth.x;
        const dy = player.y - moth.y;
        const d = Math.hypot(dx, dy) || 1;

        if (moth.type === "charger" && d < 260) {
            moth.x += (dx / d) * moth.speed * slow * dt;
            moth.y += (dy / d) * moth.speed * slow * dt;
        } else {
            const steer = moth.type === "shooter" ? 0.32 : 0.75;

            moth.vx += (dx / d) * steer * dt;
            moth.vy += (dy / d) * steer * dt;

            const v = Math.hypot(moth.vx, moth.vy) || 1;
            const maxSpeed = moth.speed * slow;

            moth.vx = (moth.vx / v) * maxSpeed;
            moth.vy = (moth.vy / v) * maxSpeed;

            moth.x += moth.vx * dt;
            moth.y += moth.vy * dt;
            moth.x += Math.sin(moth.phase * 1.4) * 8 * dt;
        }

        if (moth.type === "shooter") {
            moth.shootTimer -= dt * slow;

            if (moth.shootTimer <= 0) {
                shootEnemy(moth, true);
                moth.shootTimer = random(2.6, 3.8) / diff.bulletSpeed;
            }
        }

        moth.x = clamp(moth.x, 14, W - 14);
        moth.y = clamp(moth.y, 20, H - 20);
    }
}

// ==================================================
// MOVIMENTO DO JOGADOR
// ==================================================

function updatePlayer(dt) {
    let dx = 0;
    let dy = 0;

    if (keys.ArrowLeft || keys.KeyA) dx--;
    if (keys.ArrowRight || keys.KeyD) dx++;
    if (keys.ArrowUp || keys.KeyW) dy--;
    if (keys.ArrowDown || keys.KeyS) dy++;

    const length = Math.hypot(dx, dy);

    if (length > 0) {
        dx /= length;
        dy /= length;
    }

    if ((keys.Space || keys.ShiftLeft) && player.dashCooldown <= 0) {
        if (length === 0) {
            dx = 0;
            dy = -1;
        }

        player.dashX = dx;
        player.dashY = dy;
        player.dashTime = 0.18;
        player.dashCooldown = 2;
        player.invulnerable = Math.max(player.invulnerable, 0.35);

        createParticles(player.x, player.y, "#dce8f0", 12);
    }

    let speed = player.speed;

    if (player.dashTime > 0) {
        speed *= 2.7;
        dx = player.dashX;
        dy = player.dashY;
        player.dashTime = Math.max(0, player.dashTime - dt);
    }

    player.x += dx * speed * dt;
    player.y += dy * speed * dt;

    player.x = clamp(player.x, 18, W - 18);
    player.y = clamp(player.y, 20, H - 18);

    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);

    powerShield = Math.max(0, powerShield - dt);
    powerSlow = Math.max(0, powerSlow - dt);
    powerCooldown = Math.max(0, powerCooldown - dt);

    player.shootTimer -= dt;

    if (player.shootTimer <= 0) {
        shootPlayer();
        player.shootTimer = 0.1;
    }
}

// ==================================================
// COLISÕES DOS PROJÉTEIS
// ==================================================

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];

        bullet.x += bullet.vx * dt;
        bullet.y += bullet.vy * dt;
        bullet.life -= dt;

        if (
            bullet.life <= 0 ||
            bullet.x < -20 || bullet.x > W + 20 ||
            bullet.y < -20 || bullet.y > H + 20
        ) {
            bullets.splice(i, 1);
            continue;
        }

        let hit = false;

        for (let j = moths.length - 1; j >= 0; j--) {
            const moth = moths[j];

            if (distance(bullet, moth) < bullet.radius + moth.radius * 0.75) {
                moth.hp--;
                createParticles(bullet.x, bullet.y, "#dce8f0", 4);
                hit = true;

                if (moth.hp <= 0) {
                    defeatMoth(j);
                }

                break;
            }
        }

        if (hit) {
            bullets.splice(i, 1);
        }
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const bullet = enemyBullets[i];

        bullet.x += bullet.vx * dt;
        bullet.y += bullet.vy * dt;
        bullet.life -= dt;

        if (
            bullet.life <= 0 ||
            bullet.x < -25 || bullet.x > W + 25 ||
            bullet.y < -25 || bullet.y > H + 25
        ) {
            enemyBullets.splice(i, 1);
        }
    }
}

function takeDamage() {
    if (player.invulnerable > 0 || powerShield > 0) return false;

    lives--;
    player.invulnerable = 1.5;
    damageFlash = 0.22;
    screenShake = 6;

    createParticles(player.x, player.y, "#d2b1b0", 18);
    updateHUD();

    if (lives <= 0) {
        finishGame();
        return true;
    }

    return false;
}

function checkCollisions() {
    if (player.invulnerable > 0 || powerShield > 0) return;

    for (const moth of moths) {
        if (distance(player, moth) < player.radius + moth.radius * 0.72) {
            if (takeDamage()) return;
            break;
        }
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        if (
            distance(player, enemyBullets[i]) <
            player.radius + enemyBullets[i].radius
        ) {
            enemyBullets.splice(i, 1);

            if (takeDamage()) return;
            break;
        }
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.life -= dt;

        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }
}

// ==================================================
// DIFICULDADE PROGRESSIVA
// ==================================================

function update(dt) {
    elapsed += dt;

    const nextLevel = Math.floor(elapsed / 25) + 1;

    if (nextLevel !== level) {
        level = nextLevel;
        updateHUD();

        if (level % 5 === 0) {
            spawnBoss();
        }

        createParticles(W / 2, H / 2, "#e8d4b4", 25);
    }

    const diff = difficulty();

    spawnTimer -= dt;
    flowerTimer -= dt;
    butterflyTimer -= dt;

    if (spawnTimer <= 0) {
        const maxMoths = Math.min(13, 4 + level);

        if (moths.filter(m => m.type !== "boss").length < maxMoths) {
            spawnMoth();
        }

        spawnTimer = diff.spawn;
    }

    if (flowerTimer <= 0) {
        spawnFlower();
        flowerTimer = random(2.2, 3.5);
    }

    if (butterflyTimer <= 0) {
        spawnButterfly();
        butterflyTimer = random(8, 12);
    }

    updatePlayer(dt);
    updateMoths(dt);
    updateBullets(dt);
    collectItems();
    checkCollisions();
    updateParticles(dt);

    screenShake = Math.max(0, screenShake - 22 * dt);
    damageFlash = Math.max(0, damageFlash - dt);
}

// ==================================================
// CENÁRIO: CÉU, LUA, ESTRELAS E COLINAS
// ==================================================

function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, W, H);

    gradient.addColorStop(0, "#26364f");
    gradient.addColorStop(0.42, "#526983");
    gradient.addColorStop(1, "#a6aab4");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(
        W * 0.72, H * 0.18, 5,
        W * 0.72, H * 0.18, 250
    );

    glow.addColorStop(0, "rgba(232, 212, 180, 0.24)");
    glow.addColorStop(1, "rgba(232, 212, 180, 0)");

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Lua crescente.
    ctx.save();

    ctx.shadowColor = "#e8d4b4";
    ctx.shadowBlur = 28;
    ctx.fillStyle = "#e5d7c0";

    ctx.beginPath();
    ctx.arc(W - 105, 90, 37, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "destination-out";

    ctx.beginPath();
    ctx.arc(W - 88, 77, 34, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Estrelas.
    for (const star of stars) {
        const alpha = star.alpha * (
            0.65 + 0.35 * Math.sin(elapsed * star.speed + star.phase)
        );

        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#fff1dc";

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.globalAlpha = 1;

    // Colinas em camadas.
    for (let layer = 0; layer < 4; layer++) {
        const base = H - (layer * 16 + 22);

        ctx.beginPath();
        ctx.moveTo(0, H);
        ctx.lineTo(0, base);

        for (let x = 0; x <= W; x += 12) {
            const wave = Math.sin(
                x * 0.012 + layer * 1.8 + elapsed * 0.08
            ) * (12 + layer * 5);

            const detail = Math.sin(x * 0.028 + layer) * 5;

            ctx.lineTo(x, base + wave + detail);
        }

        ctx.lineTo(W, H);
        ctx.closePath();

        ctx.fillStyle = [
            "#78899a",
            "#586d83",
            "#3b526b",
            "#243b52"
        ][layer];

        ctx.globalAlpha = 0.3 + layer * 0.18;
        ctx.fill();
    }

    ctx.globalAlpha = 1;

    // Pequenas flores na parte inferior.
    for (let i = 0; i < 28; i++) {
        const x = (i * 83 + 23) % W;
        const y = H - 9 - (i % 4) * 6;

        ctx.strokeStyle = "#c5d0d5";
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - 8);
        ctx.stroke();

        ctx.fillStyle = i % 2 ? "#d7b8b4" : "#e0e4e9";

        ctx.beginPath();
        ctx.arc(x, y - 9, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ==================================================
// DESENHO DAS FLORES E BORBOLETAS
// ==================================================

function drawFlower(flower) {
    const bob = Math.sin(elapsed * 2.2 + flower.phase) * 3;

    ctx.save();
    ctx.translate(flower.x, flower.y + bob);
    ctx.rotate(Math.sin(elapsed + flower.rotation) * 0.12);

    if (flower.power) {
        const color = powers[flower.power].color;

        ctx.shadowColor = color;
        ctx.shadowBlur = 18;
        ctx.fillStyle = color;

        ctx.beginPath();
        ctx.ellipse(-6, -4, 6, 8, -0.45, 0, Math.PI * 2);
        ctx.ellipse(6, -4, 6, 8, 0.45, 0, Math.PI * 2);
        ctx.ellipse(-5, 4, 4, 6, 0.4, 0, Math.PI * 2);
        ctx.ellipse(5, 4, 4, 6, -0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#fff5e6";
        ctx.lineWidth = 1.4;

        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(0, 7);
        ctx.moveTo(-1, -5);
        ctx.lineTo(-4, -9);
        ctx.moveTo(1, -5);
        ctx.lineTo(4, -9);
        ctx.stroke();
    } else {
        ctx.shadowColor = "#d4e8ff";
        ctx.shadowBlur = 17;

        for (let i = 0; i < 6; i++) {
            const angle = i * Math.PI / 3;

            ctx.beginPath();
            ctx.ellipse(
                Math.cos(angle) * flower.radius * 0.55,
                Math.sin(angle) * flower.radius * 0.55,
                flower.radius * 0.35,
                flower.radius * 0.62,
                angle,
                0,
                Math.PI * 2
            );

            ctx.fillStyle = i % 2 ? "#b8cce2" : "#e3e7ed";
            ctx.fill();
        }

        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ead5b0";

        ctx.beginPath();
        ctx.arc(0, 0, flower.radius * 0.3, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

// ==================================================
// JOGADOR: BOLA AZUL
// ==================================================

function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);

    if (
        player.invulnerable > 0 &&
        Math.floor(elapsed * 16) % 2 === 0
    ) {
        ctx.globalAlpha = 0.48;
    }

    if (powerShield > 0) {
        ctx.strokeStyle = "#8ad7ff";
        ctx.lineWidth = 2;
        ctx.shadowColor = "#8ad7ff";
        ctx.shadowBlur = 20;

        ctx.beginPath();
        ctx.arc(0, 0, 24 + Math.sin(elapsed * 8) * 2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowBlur = 0;
    }

    ctx.shadowBlur = 25;
    ctx.shadowColor = "#e8d4b4";
    ctx.fillStyle = "#e9d8c4";

    ctx.beginPath();
    ctx.arc(0, 0, player.radius + 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    const ballGradient = ctx.createRadialGradient(-4, -5, 1, 0, 0, 18);

    ballGradient.addColorStop(0, "#a5bbd1");
    ballGradient.addColorStop(0.48, "#718ba8");
    ballGradient.addColorStop(1, "#344c69");

    ctx.fillStyle = ballGradient;

    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 249, 235, 0.85)";

    ctx.beginPath();
    ctx.ellipse(-4, -4, 3.5, 5, -0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#e8d4b4";
    ctx.lineWidth = 1.8;
    ctx.shadowColor = "#e8d4b4";
    ctx.shadowBlur = 9;

    ctx.beginPath();
    ctx.arc(
        0, 0, player.radius + 7,
        elapsed * 1.6,
        elapsed * 1.6 + Math.PI * 1.35
    );
    ctx.stroke();

    ctx.shadowBlur = 0;

    if (player.dashTime > 0) {
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = "#f0ddc3";
        ctx.lineWidth = 5;
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(-player.dashX * 9, -player.dashY * 9);
        ctx.lineTo(-player.dashX * 24, -player.dashY * 24);
        ctx.stroke();
    }

    ctx.restore();
}

// ==================================================
// DESENHO DOS INIMIGOS
// ==================================================

function drawMoth(moth) {
    ctx.save();
    ctx.translate(moth.x, moth.y);

    const flap = Math.sin(elapsed * 12 + moth.phase) * 0.45;

    if (moth.type === "boss") {
        ctx.shadowColor = "#d2b1b0";
        ctx.shadowBlur = 22;
        ctx.fillStyle = "#bd91a5";

        ctx.beginPath();
        ctx.ellipse(0, 0, 28, 23, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = "#e6d6d8";

        ctx.beginPath();
        ctx.ellipse(-18, -9, 14, 11, -0.5, 0, Math.PI * 2);
        ctx.ellipse(18, -9, 14, 11, 0.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#40536b";

        ctx.beginPath();
        ctx.arc(-8, -1, 3, 0, Math.PI * 2);
        ctx.arc(8, -1, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fillRect(-29, -38, 58, 4);

        ctx.fillStyle = "#f7a7d8";
        ctx.fillRect(
            -29,
            -38,
            58 * Math.max(0, moth.hp / moth.maxHp),
            4
        );
    } else {
        ctx.fillStyle = moth.type === "shooter"
            ? "#b7a5e8"
            : moth.type === "charger"
                ? "#d2a19b"
                : "#d9d7d5";

        ctx.shadowColor = "#e8d4e1";
        ctx.shadowBlur = 10;

        ctx.beginPath();
        ctx.ellipse(
            -moth.radius * 0.5, -3,
            moth.radius * 0.65, moth.radius * 0.43,
            -0.5 + flap, 0, Math.PI * 2
        );

        ctx.ellipse(
            moth.radius * 0.5, -3,
            moth.radius * 0.65, moth.radius * 0.43,
            0.5 - flap, 0, Math.PI * 2
        );

        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = "#e5c6bd";

        ctx.beginPath();
        ctx.ellipse(0, 0, 3, moth.radius * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

// ==================================================
// DESENHO DOS TIROS E PARTÍCULAS
// ==================================================

function drawBullets() {
    for (const bullet of bullets) {
        ctx.save();
        ctx.fillStyle = "#e3edf7";
        ctx.shadowColor = "#b9d7f0";
        ctx.shadowBlur = 12;

        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    for (const bullet of enemyBullets) {
        ctx.save();
        ctx.fillStyle = "#e6b6c4";
        ctx.shadowColor = "#e6a8bd";
        ctx.shadowBlur = 10;

        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.globalAlpha = 1;
}

function drawPowerHint() {
    if (!currentPower) return;

    const power = powers[currentPower];

    ctx.save();
    ctx.fillStyle = "rgba(28, 43, 63, 0.76)";
    ctx.fillRect(12, 12, 178, 34);

    ctx.strokeStyle = power.color;
    ctx.strokeRect(12, 12, 178, 34);

    ctx.fillStyle = power.color;
    ctx.font = "12px sans-serif";
    ctx.fillText(`E  ·  ${power.name}`, 22, 33);

    ctx.restore();
}

function drawGame() {
    ctx.save();

    if (screenShake > 0) {
        ctx.translate(
            random(-screenShake, screenShake),
            random(-screenShake, screenShake)
        );
    }

    drawBackground();

    for (const flower of flowers) drawFlower(flower);
    for (const moth of moths) drawMoth(moth);

    drawBullets();
    drawParticles();
    drawPlayer();
    drawPowerHint();

    if (damageFlash > 0) {
        ctx.fillStyle = `rgba(210, 120, 145, ${damageFlash * 0.5})`;
        ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
}

// ==================================================
// CONTROLES
// ==================================================

window.addEventListener("keydown", event => {
    keys[event.code] = true;

    if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]
            .includes(event.code)
    ) {
        event.preventDefault();
    }

    if (event.code === "KeyE" && !event.repeat) {
        usePower();
    }

    if (event.code === "Escape" && !event.repeat) {
        togglePause();
    }
});

window.addEventListener("keyup", event => {
    keys[event.code] = false;
});

if (startBtn) {
    startBtn.addEventListener("click", () => {
        if (running && paused) {
            togglePause();
        } else {
            startGame();
        }
    });
}

function gameLoop(timestamp) {
    if (!running || paused) return;

    const dt = Math.min((timestamp - lastTime) / 1000, 0.033);
    lastTime = timestamp;

    update(dt);
    drawGame();

    if (running && !paused) {
        animationId = requestAnimationFrame(gameLoop);
    }
}

// Tela inicial.
updateHUD();
drawGame();

showOverlay(
    "The garden is waiting.",
    "Um pequeno sonho arcade inspirado em céus azulados, flores antigas e na atmosfera de Blue Banisters. Colete flores, encontre borboletas mágicas e sobreviva à noite.",
    "Enter the garden"
);
