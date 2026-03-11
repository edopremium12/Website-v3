import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, update, remove, get } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-database.js";

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

// State Global
let currentUser = null;
let currentRoomId = null;
let isRegisterMode = false;

// DOM Elements
const views = {
    auth: document.getElementById('view-auth'),
    dashboard: document.getElementById('view-dashboard'),
    game: document.getElementById('view-game')
};

// --- AUTH LOGIC ---
const toggleAuth = () => {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-title').innerText = isRegisterMode ? "Daftar Arena" : "Login Arena";
    document.getElementById('register-fields').classList.toggle('hidden-view');
    document.getElementById('confirm-pass-field').classList.toggle('hidden-view');
    document.getElementById('btn-main-auth').innerText = isRegisterMode ? "Daftar Akun" : "Masuk";
    document.getElementById('auth-toggle-text').innerText = isRegisterMode ? "Sudah punya akun?" : "Belum punya akun?";
    document.getElementById('auth-toggle-btn').innerText = isRegisterMode ? "Login" : "Daftar Sekarang";
};

document.getElementById('auth-toggle-btn').onclick = (e) => { e.preventDefault(); toggleAuth(); };

document.getElementById('btn-main-auth').onclick = async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;

    if (isRegisterMode) {
        const name = document.getElementById('reg-name').value;
        const city = document.getElementById('reg-city').value;
        const confirm = document.getElementById('reg-confirm-pass').value;

        if (pass !== confirm) return alert("Password tidak cocok!");
        
        try {
            const res = await createUserWithEmailAndPassword(auth, email, pass);
            await set(ref(db, 'users/' + res.user.uid), {
                name, city, email, wins: 0
            });
            alert("Berhasil Daftar!");
        } catch (err) { alert(err.message); }
    } else {
        signInWithEmailAndPassword(auth, email, pass).catch(err => alert(err.message));
    }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

// --- NAVIGATION & OBSERVER ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        showView('dashboard');
        loadUserData();
        listenRooms();
    } else {
        currentUser = null;
        showView('auth');
    }
});

function showView(viewId) {
    Object.values(views).forEach(v => v.classList.add('hidden-view'));
    views[viewId].classList.remove('hidden-view');
}

async function loadUserData() {
    onValue(ref(db, `users/${currentUser.uid}`), (snap) => {
        const data = snap.val();
        if (data) {
            document.getElementById('user-display-name').innerText = data.name;
            document.getElementById('user-wins').innerText = data.wins;
        }
    });
}

// --- ROOM LOGIC ---
document.getElementById('btn-create-room').onclick = async () => {
    const name = document.getElementById('room-name').value || "Battle Room";
    const pin = document.getElementById('room-pin').value;
    
    const newRoomRef = push(ref(db, 'rooms'));
    const roomId = newRoomRef.key;

    await set(newRoomRef, {
        id: roomId,
        name: name,
        pin: pin || null,
        status: 'waiting',
        player1: { uid: currentUser.uid, name: document.getElementById('user-display-name').innerText, choice: null },
        player2: null
    });

    joinRoomLogic(roomId);
};

function listenRooms() {
    const roomListDiv = document.getElementById('room-list');
    onValue(ref(db, 'rooms'), (snap) => {
        roomListDiv.innerHTML = "";
        snap.forEach((child) => {
            const room = child.val();
            if (room.status === 'finished') return;

            const isPrivate = room.pin ? "🔒 Private" : "🔓 Public";
            const item = document.createElement('div');
            item.className = "flex justify-between items-center glass p-4 rounded-xl border border-gray-700 hover:border-cyan-500 transition cursor-pointer";
            item.innerHTML = `
                <div>
                    <p class="font-bold">${room.name}</p>
                    <p class="text-xs text-gray-400">${isPrivate} | Player: ${room.player2 ? '2/2' : '1/2'}</p>
                </div>
                <button class="bg-cyan-600 px-4 py-1 rounded text-sm font-bold">JOIN</button>
            `;
            item.onclick = () => promptJoin(room);
            roomListDiv.appendChild(item);
        });
    });
}

async function promptJoin(room) {
    if (room.player1.uid === currentUser.uid) return joinRoomLogic(room.id);
    if (room.player2) return alert("Room Penuh!");

    if (room.pin) {
        const inputPin = prompt("Masukkan PIN Room:");
        if (inputPin !== room.pin) return alert("PIN Salah!");
    }

    await update(ref(db, `rooms/${room.id}`), {
        player2: { uid: currentUser.uid, name: document.getElementById('user-display-name').innerText, choice: null },
        status: 'playing'
    });
    joinRoomLogic(room.id);
}

function joinRoomLogic(roomId) {
    currentRoomId = roomId;
    showView('game');
    document.getElementById('game-room-title').innerText = "ROOM: " + roomId.substring(0,6);
    listenGame();
}

// --- GAMEPLAY ENGINE ---
function listenGame() {
    onValue(ref(db, `rooms/${currentRoomId}`), (snap) => {
        const room = snap.val();
        if (!room) return;

        const isP1 = room.player1.uid === currentUser.uid;
        const me = isP1 ? room.player1 : room.player2;
        const opponent = isP1 ? room.player2 : room.player1;

        document.getElementById('player-you-name').innerText = me.name;
        document.getElementById('your-choice-display').innerText = me.choice ? emoji(me.choice) : "?";

        if (opponent) {
            document.getElementById('player-opponent-name').innerText = opponent.name;
            document.getElementById('opponent-status').innerText = opponent.choice ? "Sudah Memilih" : "Sedang Memilih...";
            
            if (me.choice && opponent.choice) {
                document.getElementById('opponent-choice-display').innerText = emoji(opponent.choice);
                calculateWinner(me.choice, opponent.choice, isP1);
            } else {
                document.getElementById('opponent-choice-display').innerText = "?";
                document.getElementById('result-overlay').classList.add('hidden-view');
            }
        }
    });
}

window.makeChoice = async (choice) => {
    const roomRef = ref(db, `rooms/${currentRoomId}`);
    const snap = await get(roomRef);
    const room = snap.val();
    const path = room.player1.uid === currentUser.uid ? 'player1/choice' : 'player2/choice';
    await update(roomRef, { [path]: choice });
};

function emoji(choice) {
    if (choice === 'batu') return '✊';
    if (choice === 'kertas') return '✋';
    if (choice === 'gunting') return '✌️';
    return '?';
}

async function calculateWinner(myChoice, opChoice, isP1) {
    let result = "";
    if (myChoice === opChoice) result = "SERI!";
    else if (
        (myChoice === 'batu' && opChoice === 'gunting') ||
        (myChoice === 'kertas' && opChoice === 'batu') ||
        (myChoice === 'gunting' && opChoice === 'kertas')
    ) {
        result = "KAMU MENANG!";
        // Update win limit in user data (only once)
        const userRef = ref(db, `users/${currentUser.uid}/wins`);
        const winSnap = await get(userRef);
        await set(userRef, (winSnap.val() || 0) + 1);
    } else {
        result = "KAMU KALAH!";
    }

    document.getElementById('game-result-text').innerText = result;
    document.getElementById('result-overlay').classList.remove('hidden-view');
}

window.resetGame = async () => {
    await update(ref(db, `rooms/${currentRoomId}`), {
        'player1/choice': null,
        'player2/choice': null
    });
};

document.getElementById('btn-leave-room').onclick = async () => {
    if(confirm("Keluar dari room?")) {
        // Logika sederhana: hapus room jika player 1 keluar
        await remove(ref(db, `rooms/${currentRoomId}`));
        currentRoomId = null;
        showView('dashboard');
    }
};
