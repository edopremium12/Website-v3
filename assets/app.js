import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, update, remove, get, query, orderByChild, limitToLast, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-database.js";

// --- KONFIGURASI FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyAgp27hYSZ433dBtrVDwmatt5xCJ6EOt9U",
    authDomain: "cayang.firebaseapp.com",
    databaseURL: "https://cayang-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "cayang",
    storageBucket: "cayang.firebasestorage.app",
    messagingSenderId: "960652456673",
    appId: "1:960652456673:web:21f18d74ad28728e187da0"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// --- GLOBAL STATE ---
let currentUser = null;
let userData = null;
let currentRoomId = null;
let isRegisterMode = false;
let battleProcessed = false;
let selectedTempChoice = null;
let lastKnownLevel = null;
let lastKnownRank = null;

const views = { 
    auth: document.getElementById('view-auth'), 
    dashboard: document.getElementById('view-dashboard'), 
    game: document.getElementById('view-game') 
};

// --- SISTEM NOTIFIKASI & SUARA ---
async function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
    }
}

function sendBrowserNotif(title, body) {
    if (Notification.permission === "granted") {
        new Notification(title, { body, icon: "https://cdn-icons-png.flaticon.com/512/1041/1041916.png" });
    }
}

function playSound(id) {
    const snd = document.getElementById(id);
    if (snd) {
        snd.currentTime = 0;
        snd.play().catch(() => console.log("Interaksi diperlukan untuk audio."));
    }
}

// --- NAVIGASI VIEW ---
function showView(viewId) {
    Object.values(views).forEach(v => v.classList.add('hidden-view'));
    views[viewId].classList.remove('hidden-view');
}

// --- AUTH LOGIC ---
document.getElementById('auth-toggle-btn').onclick = () => {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-subtitle').innerText = isRegisterMode ? "Buat akun kompetitor baru" : "Masuk untuk memulai pertempuran";
    document.getElementById('register-fields').classList.toggle('hidden-view');
    document.getElementById('confirm-pass-field').classList.toggle('hidden-view');
    document.getElementById('btn-main-auth').innerText = isRegisterMode ? "Daftar Akun" : "Masuk Sekarang";
    document.getElementById('auth-toggle-btn').innerText = isRegisterMode ? "Login" : "Daftar";
};

document.getElementById('btn-main-auth').onclick = async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;

    if (isRegisterMode) {
        const name = document.getElementById('reg-name').value;
        const city = document.getElementById('reg-city').value;
        const confirm = document.getElementById('reg-confirm-pass').value;
        if (!name || !city || pass !== confirm) return alert("Cek kembali data Anda!");

        try {
            const res = await createUserWithEmailAndPassword(auth, email, pass);
            await set(ref(db, 'users/' + res.user.uid), { name, city, email, wins: 0, xp: 0, points: 0, level: 1 });
        } catch (err) { alert(err.message); }
    } else {
        signInWithEmailAndPassword(auth, email, pass).catch(err => alert("Login Gagal: " + err.message));
    }
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loadUserData();
        listenRooms();
        requestNotificationPermission();
        showView('dashboard');
    } else {
        currentUser = null;
        showView('auth');
    }
});

document.getElementById('btn-logout').onclick = () => signOut(auth);

async function loadUserData() {
    onValue(ref(db, `users/${currentUser.uid}`), (snap) => {
        userData = snap.val();
        if (userData) {
            if (lastKnownLevel !== null && userData.level > lastKnownLevel) {
                playSound('snd-level-up');
                sendBrowserNotif("LEVEL UP! 🚀", `Selamat ${userData.name}! Naik ke Level ${userData.level}!`);
            }
            lastKnownLevel = userData.level;
            document.getElementById('user-display-name').innerText = userData.name;
            document.getElementById('user-wins').innerText = userData.wins;
            document.getElementById('user-level').innerText = userData.level;
            document.getElementById('user-points').innerText = userData.points;
            document.getElementById('user-xp').innerText = userData.xp;
            document.getElementById('xp-bar').style.width = (userData.xp % 100) + "%";
        }
    });
}

// --- LOBBY & AUTO-EXPIRE ---
document.getElementById('btn-create-room').onclick = async () => {
    const name = (document.getElementById('room-name').value || "BATTLE ARENA").toUpperCase();
    const pin = document.getElementById('room-pin').value;
    const newRoomRef = push(ref(db, 'rooms'));
    const roomId = newRoomRef.key;

    onDisconnect(newRoomRef).remove(); // Auto-delete jika owner DC

    await set(newRoomRef, {
        id: roomId, name, pin: pin || null, status: 'waiting', owner: currentUser.uid,
        player1: { uid: currentUser.uid, name: userData.name, choice: null },
        player2: null
    });
    joinRoomLogic(roomId);
};

function listenRooms() {
    onValue(ref(db, 'rooms'), (snap) => {
        const list = document.getElementById('room-list');
        list.innerHTML = "";
        snap.forEach(child => {
            const room = child.val();
            const item = document.createElement('div');
            item.className = "flex justify-between items-center glass p-5 rounded-2xl hover:border-cyan-500 cursor-pointer transition";
            item.innerHTML = `<div><h4 class="font-black text-sm">${room.name} ${room.pin ? '🔒' : '🔓'}</h4><p class="text-[10px] text-gray-400">HOST: ${room.player1.name}</p></div><button class="bg-cyan-600 px-4 py-2 rounded-xl text-[10px] font-black">JOIN</button>`;
            item.onclick = () => {
                if (room.pin && prompt("Masukkan PIN:") !== room.pin) return alert("PIN Salah!");
                joinExistingRoom(room);
            };
            list.appendChild(item);
        });
    });
}

async function joinExistingRoom(room) {
    if (room.player1.uid !== currentUser.uid && !room.player2) {
        await update(ref(db, `rooms/${room.id}`), {
            player2: { uid: currentUser.uid, name: userData.name, choice: null },
            status: 'playing'
        });
    }
    joinRoomLogic(room.id);
}

function joinRoomLogic(roomId) {
    currentRoomId = roomId;
    battleProcessed = false;
    showView('game');
    document.getElementById('game-room-title').innerText = "ARENA ID: " + roomId.substring(0, 6);
    listenGame();
    listenChat();
}

// --- GAMEPLAY DENGAN TOMBOL OK ---
window.selectChoice = (choice, element) => {
    selectedTempChoice = choice;
    document.querySelectorAll('.choice-btn').forEach(btn => btn.classList.replace('bg-cyan-600', 'bg-slate-800'));
    element.classList.replace('bg-slate-800', 'bg-cyan-600');
    document.getElementById('btn-confirm-choice').classList.remove('hidden-view');
    document.getElementById('your-choice-display').innerText = emoji(choice);
};

document.getElementById('btn-confirm-choice').onclick = async () => {
    if (!selectedTempChoice) return;
    const roomSnap = await get(ref(db, `rooms/${currentRoomId}`));
    const room = roomSnap.val();
    const path = room.player1.uid === currentUser.uid ? 'player1/choice' : 'player2/choice';
    await update(ref(db, `rooms/${currentRoomId}`), { [path]: selectedTempChoice });
    document.getElementById('controls').classList.add('hidden-view');
    document.getElementById('btn-confirm-choice').classList.add('hidden-view');
};

function listenGame() {
    onValue(ref(db, `rooms/${currentRoomId}`), (snap) => {
        const room = snap.val();
        if (!room) {
            alert("Room Expired (Owner Left)!");
            window.location.reload();
            return;
        }

        const isP1 = room.player1.uid === currentUser.uid;
        const me = isP1 ? room.player1 : room.player2;
        const op = isP1 ? room.player2 : room.player1;

        document.getElementById('player-you-name').innerText = me.name;
        document.getElementById('your-choice-display').innerText = me.choice ? emoji(me.choice) : (selectedTempChoice ? emoji(selectedTempChoice) : "?");

        if (op) {
            document.getElementById('player-opponent-name').innerText = op.name;
            document.getElementById('opponent-status').innerText = op.choice ? "READY" : "CHOOSING...";
            if (me.choice && op.choice && !battleProcessed) {
                battleProcessed = true;
                document.getElementById('battle-loading').classList.remove('hidden-view');
                setTimeout(() => {
                    document.getElementById('battle-loading').classList.add('hidden-view');
                    document.getElementById('opponent-choice-display').innerText = emoji(op.choice);
                    document.getElementById('opponent-choice-display').classList.remove('grayscale', 'opacity-30');
                    calculateWinner(me.choice, op.choice);
                }, 2000);
            }
        }
    });
}

function emoji(c) { return c === 'batu' ? '✊' : c === 'kertas' ? '✋' : '✌️'; }

async function calculateWinner(myC, opC) {
    let res = ""; let isWin = false; let isDraw = myC === opC;
    if (isDraw) res = "SERI!";
    else if ((myC === 'batu' && opC === 'gunting') || (myC === 'kertas' && opC === 'batu') || (myC === 'gunting' && opC === 'kertas')) {
        res = "MENANG!"; isWin = true; playSound('snd-win');
    } else {
        res = "KALAH!"; playSound('snd-lose');
    }

    document.getElementById('game-result-text').innerText = res;
    document.getElementById('game-result-text').className = `text-6xl font-black italic mb-4 ${isDraw ? 'text-gray-400' : (isWin ? 'text-cyan-400' : 'text-red-500')}`;
    document.getElementById('result-overlay').classList.remove('hidden-view');

    const xpGain = isWin ? 50 : (isDraw ? 20 : 10);
    const newXP = (userData.xp || 0) + xpGain;
    await update(ref(db, `users/${currentUser.uid}`), {
        xp: newXP,
        points: (userData.points || 0) + (isWin ? 100 : (isDraw ? 40 : 20)),
        wins: isWin ? (userData.wins + 1) : userData.wins,
        level: Math.floor(newXP / 100) + 1
    });
}

window.resetGame = async () => {
    battleProcessed = false;
    selectedTempChoice = null;
    document.getElementById('controls').classList.remove('hidden-view');
    document.getElementById('opponent-choice-display').classList.add('grayscale', 'opacity-30');
    document.querySelectorAll('.choice-btn').forEach(btn => btn.classList.replace('bg-cyan-600', 'bg-slate-800'));
    await update(ref(db, `rooms/${currentRoomId}`), { 'player1/choice': null, 'player2/choice': null });
};

// --- CHAT SYSTEM ---
function listenChat() {
    onValue(ref(db, `rooms/${currentRoomId}/chat`), (snap) => {
        const chatDiv = document.getElementById('chat-messages');
        chatDiv.innerHTML = "";
        snap.forEach(c => {
            const m = c.val();
            chatDiv.innerHTML += `<div class="text-[11px] border-l-2 border-white/10 pl-2 py-1"><span class="text-blue-400 font-bold">${m.sender}:</span> ${m.text}</div>`;
        });
        chatDiv.scrollTop = chatDiv.scrollHeight;
    });
}

document.getElementById('btn-send-chat').onclick = () => {
    const inp = document.getElementById('chat-input');
    if (!inp.value || !currentRoomId) return;
    push(ref(db, `rooms/${currentRoomId}/chat`), { sender: userData.name, text: inp.value });
    inp.value = "";
};

// --- TOP GLOBAL ---
window.toggleLeaderboard = () => {
    const m = document.getElementById('modal-leaderboard');
    m.classList.toggle('hidden-view');
    if (!m.classList.contains('hidden-view')) {
        const q = query(ref(db, 'users'), orderByChild('points'), limitToLast(10));
        onValue(q, (snap) => {
            const list = document.getElementById('leaderboard-list');
            list.innerHTML = "";
            let arr = [];
            snap.forEach(c => { const v = c.val(); v.uid = c.key; arr.push(v); });
            arr.reverse().forEach((p, i) => {
                const rank = i + 1;
                if (p.uid === currentUser.uid && rank <= 3 && lastKnownRank !== rank) {
                    sendBrowserNotif("ELITE PLAYER! 🏆", `Kamu peringkat #${rank} Dunia!`);
                    lastKnownRank = rank;
                }
                list.innerHTML += `<div class="flex justify-between items-center glass p-5 rounded-2xl border-l-4 ${i === 0 ? 'border-yellow-500' : 'border-cyan-500'}">
                    <div class="flex items-center gap-4"><span class="text-xl font-black italic">#${rank}</span>
                    <div><p class="font-bold text-sm">${p.name}</p><p class="text-[10px] text-gray-500">Lv.${p.level}</p></div></div>
                    <p class="font-black text-yellow-500">${p.points} PTS</p></div>`;
            });
        });
    }
};

document.getElementById('btn-leave-room').onclick = () => window.location.reload();
