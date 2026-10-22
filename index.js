const {
    MessageFlags, Client, GatewayIntentBits, Events, REST, Routes,
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

// ====== ENV (ห้าม hardcode secret ในโค้ดอีก) ======
function requireEnv(name) {
    const v = process.env[name];
    if (!v) { console.error(`❌ ไม่พบ env: ${name} — ตั้งค่าใน Railway > Variables ก่อน`); process.exit(1); }
    return v;
}
const TOKEN        = requireEnv("BOT_TOKEN");
const BOT_SECRET   = requireEnv("BOT_SECRET");
const OWNER_SECRET = requireEnv("OWNER_SECRET");
const PASTEFY_KEY  = requireEnv("PASTEFY_KEY");
const MOONVEIL_KEY = requireEnv("MOONVEIL_KEY");
const OWNER_ID     = requireEnv("OWNER_ID");
const CLIENT_ID    = process.env.CLIENT_ID  || "1562640744609742909";
const SERVER_URL   = process.env.SERVER_URL || "https://server-production-a00a.up.railway.app";

// ====== HTTP: มี timeout + ไม่ throw + GET retry 1 ครั้ง (กัน server Railway หลับ/ช้า) ======
const HTTP_TIMEOUT = 10000;
async function http(method, path, { body, headers = {} } = {}) {
    for (let attempt = 0; attempt < (method === "GET" ? 2 : 1); attempt++) {
        try {
            const res = await fetch(`${SERVER_URL}${path}`, {
                method,
                headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(HTTP_TIMEOUT)
            });
            return await res.json();
        } catch (e) {
            console.error(`[http ${method}] ${e.name}: ${e.message}`);
        }
    }
    return { ok: false, reason: "server_unreachable" };
}
const botHeaders   = { "x-bot-secret": BOT_SECRET };
const ownerHeaders = { "x-owner-secret": OWNER_SECRET };
const serverGet    = (p)       => http("GET",    p, { headers: botHeaders });
const serverPost   = (p, body) => http("POST",   p, { body, headers: botHeaders });
const serverDelete = (p)       => http("DELETE", p, { headers: botHeaders });
const ownerPost    = (p, body) => http("POST",   p, { body, headers: ownerHeaders });
const kp = (k) => encodeURIComponent(String(k).trim()); // กัน path injection ใน key
const isDown = (r) => !r || r.reason === "server_unreachable";

// ====== KEY CACHE (TTL 60 วิ + ล้างของหมดอายุอัตโนมัติ ไม่ให้ Map โตเรื่อยๆ) ======
const userKeyCache = new Map();
const cacheId = (userId, guildId) => `${userId}:${guildId || ""}`;
function getCachedKey(id) {
    const c = userKeyCache.get(id);
    if (!c || Date.now() > c.expireAt) return null;
    return c;
}
function setCachedKey(id, key, data) { userKeyCache.set(id, { key, data, expireAt: Date.now() + 60000 }); }
function clearCachedKey(id) { userKeyCache.delete(id); }
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of userKeyCache) if (now > v.expireAt) userKeyCache.delete(k);
}, 5 * 60 * 1000).unref();

async function getUserKey(userId, guildId) {
    const id = cacheId(userId, guildId);
    const hit = getCachedKey(id);
    if (hit) return { cached: hit };
    const r = await serverGet(`/keys/user/${userId}?guildId=${guildId}`);
    if (isDown(r)) return { error: MSG_DOWN };
    if (!r.ok) return { error: "❌ ยังไม่ได้ Redeem Key — กดปุ่ม 🔑 Redeem Key ก่อน" };
    setCachedKey(id, r.key, r.data);
    return { cached: getCachedKey(id) };
}

const ClientLoader = `
-- ====== SERVER ======
local _S = "https://server-production-a00a.up.railway.app"

-- ====== GC BASELINE ======
local _gcBase  = gcinfo()
local _gcPhase = {}
local function _gcSnap(label) _gcPhase[label] = gcinfo() end

-- ====== SERVICES ======
local _HS  = game:GetService("HttpService")
local _PS  = game:GetService("Players")
local _MS  = game:GetService("MarketplaceService")
local _CL  = _PS.LocalPlayer
local _UGS = UserSettings():GetService("UserGameSettings")

-- ====== KEY & METADATA ======
local _ky = tostring(_G.license_key or getgenv().key or "")
if _ky == "" or _ky == "nil" then _CL:Kick("[RainX] ไม่พบ Key") return end

local _uid       = tostring(_CL.UserId)
local _acc       = tostring(math.floor(_CL.AccountAge or 0))
local _exe       = (getexecutorname and getexecutorname()) or "unidentified"
local _placeName = "unidentified"
pcall(function()
    local info = _MS:GetProductInfo(game.PlaceId)
    if info then _placeName = tostring(info.Name or "unidentified") end
end)
local _placeId = tostring(game.PlaceId)
local _jobId   = tostring(game.JobId)

-- ====== DEVICE FINGERPRINT ======
local _deviceId = "?"
do
    local _key     = "GraphicQuality"
    local _charset = "qwertyuiopasdfghjklzxcvbnm098765"
    pcall(function()
        if _UGS:GetTutorialState(_key) then
            _deviceId = ""
            local _bi = 0
            for _ = 1, 16 do
                local bits, mult = 0, 1
                for _ = 1, 5 do
                    bits = bits + (_UGS:GetTutorialState(_key .. _bi) and 1 or 0) * mult
                    mult = mult * 2; _bi = _bi + 1
                end
                _deviceId = _deviceId .. _charset:sub(bits + 1, bits + 1)
            end
        else
            _deviceId = ""
            local seed  = ({ task.wait() })[1] * 1000000
            local state = (seed - seed % 1) % 2147483648
            local idx   = 1
            local function _rng(min, max)
                local ns = 1103515245 * state + 12345
                local rv = ns % 99999999 + idx
                idx = idx + 1; state = rv
                return min + rv % (max - min + 1)
            end
            _UGS:SetTutorialState(_key, true)
            local _bi = 0
            for _ = 1, 16 do
                local bits, mult = 0, 1
                for _ = 1, 5 do
                    local bv = _rng(10, 20) > 15
                    _UGS:SetTutorialState(_key .. _bi, bv)
                    bits = bits + (bv and 1 or 0) * mult
                    mult = mult * 2; _bi = _bi + 1
                end
                _deviceId = _deviceId .. _charset:sub(bits + 1, bits + 1)
            end
        end
    end)
end
_gcSnap("fingerprint")

-- ====== LCG FACTORY ======
local function _lcgFactory(seed)
    local a, c, m = 1103515245, 12345, 99999999
    local state   = seed % 2147483648
    local idx     = 1
    return function(min, max)
        local ns = a * state + c
        local rv = ns % m + idx
        idx = idx + 1; state = rv
        c   = ns % 4859 * (m % 5781)
        return min + rv % (max - min + 1)
    end
end

-- ====== CUSTOM HASH ======
local function _customHash(value)
    for _ = 1, 2 do
        local v1 = value % 9915 + 4
        local v2, v3
        for i = 1, 3 do
            v2 = value % 4155 + 3
            if i % 2 == 1 then v2 = v2 + 522 end
            v3 = value % 9996 + 1
            if v3 % 2 ~= 1 then v3 = v3 * 3 end
        end
        local v4 = value % 9999995 + 1 + 13729
        local v5 = value % 1000
        local v6 = math.floor((value - v5) / 1000) % 1000
        local v7 = v5 * v6 + v4 + value % (419824125 - v4 + v5)
        local v8 = value % (v1 * v2 + 9999) + 13729
        value = (v7 + (v8 + (v5 * v2 + v6)) % 999999 * (v4 + v8 % v3)) % 99999999999
    end
    return value
end

-- ====== STR HASH ======
local function _strHash(s)
    local h = 0
    for i = 1, #s do h = (h * 31 + string.byte(s, i)) % 999999999 end
    return h
end

-- ====== VALIDATE STATE ======
local _authState      = -1
local _authTableStore = nil
local function _validateState(tbl)
    local map1, map2, map3 = {}, {}, {}
    for i = 1, 13 do
        local k, v = {}, {}
        map1[k] = v; map2[v] = i; map3[k] = v
    end
    local sum1, sum2, count = 0, 0, 0
    if tbl then map1 = tbl[1]; map2 = tbl[2]; map3 = tbl[3] end
    for k, v in next, map1 do
        local mapped = map2[v]
        if map3[k] == v then sum1 = sum1 + 1 end
        count = count + 1
        sum2  = count % 2 == 0 and sum2 * mapped or sum2 + mapped + count
    end
    if sum1 ~= 13 then _authState = -1 end
    _authTableStore = { map1, map2, map3 }
    _authState      = sum2
    return false
end
_validateState()
while _authState == -1 do end

-- ====== HEARTBEAT COUNTER ======
local _heartbeatCounter = 0
do
    local _hb = game:GetService("RunService").Heartbeat
    local _active = false
    spawn(function()
        _active = true
        while true do _heartbeatCounter = _heartbeatCounter + 1; _hb:Wait() end
    end)
    while not _active do _hb:Wait() end
end

-- ======================================================
-- [LuaSync technique #1] MULTI-ROUND LCG CHAIN
-- แต่ละ generator seed โดย output ของตัวก่อน
-- ทำให้ state ไม่สามารถ predict ได้จาก seed ตัวแรกตัวเดียว
-- ======================================================
local _lcgChain = {}
_lcgChain[1] = _lcgFactory(_heartbeatCounter + _authState)
for i = 2, 4 do
    local prev = _lcgChain[i - 1]
    _lcgChain[i] = _lcgFactory(
        prev(10000, 99999) + _heartbeatCounter * i + _authState
    )
end
-- lcg1 = combined seed จาก 4 rounds เพื่อให้ entropy สูงขึ้น
local _lcg1 = _lcgFactory(
    _lcgChain[1](1000, 9999)
    + _lcgChain[2](1000, 9999)
    + _lcgChain[3](1000, 9999)
    + _lcgChain[4](1000, 9999)
    + _heartbeatCounter
)
local _lcg2 = _lcgFactory(
    _lcgChain[2](5000, 99999)
    + _lcgChain[4](5000, 99999)
    + _authState
)

-- ======================================================
-- [LuaSync technique #2] TABLE ADDRESS HASH
-- tostring({}) คืน "table: 0xHEXADDR" — address ของ heap allocation
-- hash มันเข้า chain เพื่อผูก memory layout ของ runtime
-- ======================================================
local function _tableAddrHash()
    local t    = {}
    local addr = tostring(t)
    return _strHash(addr)
end
local _addrSeed = _customHash(
    _tableAddrHash() + _tableAddrHash() + _heartbeatCounter + gcinfo()
)

-- ======================================================
-- [LuaSync technique #3] UPVALUE INTEGRITY CHECK
-- ตรวจว่า upvalue ของ _customHash และ _lcgFactory
-- ไม่ถูกแก้ผ่าน debug.setupvalue
-- ======================================================
local function _checkUpvalues(fn, minCount)
    if not debug or not debug.getupvalue then return true end
    local count = 0
    while true do
        local name = debug.getupvalue(fn, count + 1)
        if not name then break end
        -- ถ้าเจอ upvalue ชื่อ "_ENV" แปลกๆ หรือ nil ผิดปกติ
        count = count + 1
    end
    return minCount == nil or count >= minCount
end

-- ======================================================
-- [LuaSync technique #4] CONSTANT FOLDING TRAP
-- ค่าที่ควรเป็น constant ตลอด — ถ้าเปลี่ยน = memory patch
-- ======================================================
local _TRAP_K1 = 0x52 + 0x61 + 0x69 + 0x6E  -- "Rain" = 0x1A7 = 423
local _TRAP_K2 = 0x58                          -- "X"    = 0x58  = 88
local _TRAP_EXPECTED = 511  -- 423 + 88
if _TRAP_K1 + _TRAP_K2 ~= _TRAP_EXPECTED then
    _CL:Kick("[RainX] constant trap failed")
    return
end

-- ====== FUNCTION CLONES ======
local _rr    = syn and syn.request or (request or http_request)
local _rg    = gethwid
local _or    = clonefunction(_rr)
local _og    = clonefunction(_rg)
local _ow    = clonefunction(warn)
local _owt   = clonefunction(task.wait)
local _oc    = clonefunction(os.clock)
local _oti   = clonefunction(os.time)
local _op    = clonefunction(pcall)
local _oip   = clonefunction(ipairs)
local _ots   = clonefunction(tostring)
local _orm   = clonefunction(math.random)
local _off   = clonefunction(string.format)
local _ogrmt = clonefunction(getrawmetatable)
local _oiro  = clonefunction(isreadonly)
local _osr   = setreadonly and clonefunction(setreadonly) or nil

local function _kick(m)
    for _ = 1, 30 do _ow(">> ได้แค่นี้หรอ:>") _owt(0.1) end
    _owt(0.3)
    _CL:Kick("[RainX] " .. (m or "ได้แค่นี้หรอ:>"))
end

-- ====== GC ASSERT ======
local _GC_MAX = { fingerprint=300, antidebug=400, challenge=600, decrypt=400 }
local function _gcAssert(phase)
    local delta = gcinfo() - _gcBase
    local limit = _GC_MAX[phase] or 500
    if delta > limit then _kick("GC/" .. phase .. ":" .. _ots(delta)) return false end
    local prev = _gcPhase[phase]
    if prev and (gcinfo() + 200) < prev then _kick("GC/shrink:" .. phase) return false end
    _gcSnap(phase)
    return true
end

-- ====== ANTI-DEBUG ======
do
    -- R0: fenv __index request
    local ok, fenv = _op(getfenv)
    if ok and fenv then
        local ok2, fmt = _op(getrawmetatable, fenv)
        if ok2 and fmt then
            local ok3, idx = _op(rawget, fmt, "__index")
            if ok3 and idx and type(idx) == "table" then
                local ok4, rq = _op(rawget, idx, "request")
                if ok4 and rq ~= nil then
                    local ok5, isC = _op(iscclosure, rq)
                    if ok5 and not isC then _kick("R0") return end
                    if rq ~= _rr then _kick("R0b") return end
                    if debug and debug.info then
                        local ok6, src = _op(debug.info, rq, "s")
                        if ok6 and src ~= "[C]" then _kick("R0c") return end
                    end
                end
            end
        end
    end

    -- R1: getgenv __index request
    local ok7, ge = _op(getgenv)
    if ok7 and ge then
        local ok8, gmt = _op(getrawmetatable, ge)
        if ok8 and gmt then
            local ok9, idx2 = _op(rawget, gmt, "__index")
            if ok9 and idx2 and type(idx2) == "table" then
                local ok10, rq2 = _op(rawget, idx2, "request")
                if ok10 and rq2 ~= nil then
                    local ok11, isC2 = _op(iscclosure, rq2)
                    if ok11 and not isC2 then _kick("R1") return end
                end
            end
        end
    end

    -- R2: request ปัจจุบัน ต้อง cclosure
    local ok12, isC3 = _op(iscclosure, _rr)
    if ok12 and not isC3 then _kick("R2") return end

    -- E0-E3: gethwid integrity
    local ok13, fenv2 = _op(getfenv)
    if ok13 and fenv2 then
        local ok14, fmt2 = _op(getrawmetatable, fenv2)
        if ok14 and fmt2 then
            local ok15, idx3 = _op(rawget, fmt2, "__index")
            if ok15 and idx3 and type(idx3) == "table" then
                local ok16, gh = _op(rawget, idx3, "gethwid")
                if ok16 and gh ~= nil then
                    local ok17, isC4 = _op(iscclosure, gh)
                    if ok17 and not isC4 then _kick("E0") return end
                end
            end
        end
    end
    local ok18, isC5 = _op(iscclosure, gethwid)
    if ok18 and not isC5 then _kick("E1") return end
    local ok19, ge2 = _op(getgenv)
    if ok19 and ge2 and ge2.gethwid then
        local ok20, isC6 = _op(iscclosure, ge2.gethwid)
        if ok20 and not isC6 then _kick("E2") return end
        local ok21, hw1 = _op(ge2.gethwid)
        local ok22, hw2 = _op(_rg)
        if ok21 and ok22 and hw1 ~= hw2 then _kick("E3") return end
    end

    -- H1-H4: hook detection
    if isfunctionhooked then
        for _, f in _oip({ _rr, _rg }) do
            local ok, h = _op(isfunctionhooked, f)
            if ok and h == true then _kick("H1") return end
        end
    end
    local _exp = syn and syn.request or (request or http_request)
    if _rr ~= _exp or _rg ~= gethwid then _kick("H2") return end
    local ok23, ge3 = _op(getgenv)
    if ok23 and ge3 then
        if ge3.request and ge3.request ~= _rr then _kick("H3") return end
        if ge3.gethwid and ge3.gethwid ~= _rg then _kick("H4") return end
    end
    local ok24, hw3 = _op(_og)
    local ok25, hw4 = _op(_rg)
    if ok24 and ok25 and hw3 ~= hw4 then _kick("H4b") return end

    -- T1: timing
    local t0 = _oc(); local s = 0
    for i = 1, 50000 do s = s + i end
    local t1 = _oc()
    if (t1 - t0) <= 0 or (t1 - t0) > 60 then _kick("T1") return end

    -- M1: metatable integrity
    if isfunctionhooked then
        local ok, h = _op(isfunctionhooked, getrawmetatable)
        if ok and h == true then _kick("M1") return end
    end
    local okM, mt = _op(_ogrmt, game)
    if okM and mt then
        local okR, ro = _op(_oiro, mt)
        if okR and ro == false then _kick("M1b") return end
    end

    -- [LuaSync technique #3] upvalue check หลัง anti-debug setup
    if not _checkUpvalues(_customHash, 0) then _kick("UV1") return end
    if not _checkUpvalues(_validateState, 0) then _kick("UV2") return end

    -- SC: setclipboard lockdown
    if setclipboard then
        local okC, isC = _op(iscclosure, setclipboard)
        if okC and not isC then _kick("SC1") return end
        if isfunctionhooked then
            local okH, h = _op(isfunctionhooked, setclipboard)
            if okH and h == true then _kick("SC2") return end
        end
    end
    local okG, ge4 = _op(getgenv)
    if okG and ge4 then
        if ge4.setclipboard then
            local okI, isC2 = _op(iscclosure, ge4.setclipboard)
            if okI and not isC2 then _kick("SC3") return end
            if setclipboard and ge4.setclipboard ~= setclipboard then _kick("SC3b") return end
        end
        ge4.setclipboard = function(...) _kick("SC5") end
        local okGmt, gmt3 = _op(_ogrmt, ge4)
        if okGmt and gmt3 then
            local okRo, ro2 = _op(_oiro, gmt3)
            if okRo and _osr and not ro2 then _osr(gmt3, true) end
        end
    end

    -- RX: late re-check
    local okRx, isCRx = _op(iscclosure, _rr)
    if okRx and not isCRx then _kick("RX") return end
end

if not _gcAssert("antidebug") then return end

-- ====== LOCAL HWID HASH VERIFY ======
local _hw     = _og()
local _hwHash = _strHash(_hw)
do
    local okU, ugs = _op(function() return UserSettings():GetService("UserGameSettings") end)
    if okU and ugs then
        local hkey = "hwid_h_"; local hkeySet = hkey .. "set"
        local maxBits = 26; local modVal = 67108864
        local okG, isSet = _op(function() return ugs:GetTutorialState(hkeySet) end)
        if okG and isSet then
            local stored = 0; local mult = 1
            for i = 0, maxBits - 1 do
                local okB, bit = _op(function() return ugs:GetTutorialState(hkey .. i) end)
                if okB and bit then stored = stored + mult end
                mult = mult * 2
            end
            if stored ~= _hwHash % modVal then _kick("HWID mismatch") return end
        else
            local val = _hwHash % modVal
            for i = 0, maxBits - 1 do
                _op(function() ugs:SetTutorialState(hkey .. i, val % 2 == 1) end)
                val = math.floor(val / 2)
            end
            _op(function() ugs:SetTutorialState(hkeySet, true) end)
        end
    end
end

-- ====== NONCE ======
local function _nn()
    local h = ""
    for _ = 1, 32 do h = h .. _off("%x", _orm(0, 15)) end
    return h
end

-- ====== FINGERPRINT ======
local _r1v    = _lcg1(100000, 1000000)
local _r2v    = _lcg2(100000, 1000000)
local _fpHash = _customHash(_r1v + _r2v + _heartbeatCounter)
local _devHash = _strHash(_deviceId or "?")
local _fp     = _ots(_hwHash) .. _uid .. _acc .. (_deviceId or "?") .. _ots(_fpHash)

-- ======================================================
-- HASH CHAIN INIT
-- chain[0] ผูก: hwid + deviceId + heartbeat + GC
--           + addrSeed (table address fingerprint)
--           + LCG chain output (multi-round entropy)
-- ======================================================
local _chain = _customHash(
    (_hwHash + _devHash + _heartbeatCounter + gcinfo()
     + _addrSeed
     + _lcg1(1, 99999) + _lcg2(1, 99999)
    ) % 99999999999
)

_ow("[RainX] กำลังเช็คสิทธิ์...")

-- ======================================================
-- PHASE 1: CHALLENGE
-- chain[1] = chain[0] + d1.k_hash + heartbeat
-- ======================================================
local _nc  = _nn()
local _ts1 = _oti()

local _ok1, _res1 = _op(function()
    return _or({
        Url    = _S .. "/cdn-cgi/challenge",
        Method = "POST",
        Headers = { ["Content-Type"] = "application/json" },
        Body   = _HS:JSONEncode({
            key     = _ky,
            hwid    = _ots(_hwHash),
            ts      = _ts1,
            nonce   = _nc,
            fp      = _fp,
            exe     = _exe,
            place   = _placeName,
            placeId = _placeId,
            jobId   = _jobId,
            chain   = _ots(_chain),
        })
    })
end)

if not _ok1 or not _res1 or not _res1.Body then _kick("challenge failed") return end
local _d1   = _HS:JSONDecode(_res1.Body)
local _errs = { key="Key ไม่ถูกต้อง", exp="Key หมดอายุแล้ว", hwid="reset hwid ก่อน", rate="ช้าลงหน่อย" }
if not _d1 or _d1.e then
    _ow("[RainX] " .. (_errs[_d1 and _d1.e] or "challenge error"))
    for _ = 1, 30 do _ow(">> ได้แค่นี้หรอ:>") _owt(0.1) end
    _CL:Kick("[RainX] " .. (_errs[_d1 and _d1.e] or "ได้แค่นี้หรอ:>"))
    return
end
if not _d1.s or not _d1.k then _kick("bad challenge response") return end

if not _gcAssert("challenge") then return end

-- chain[1]
_chain = _customHash(_chain + _strHash(_d1.k) + _heartbeatCounter + _addrSeed)

-- ======================================================
-- PHASE 2: TOKEN
-- chain[2] = chain[1] + strHash(d2.d) + authState
-- ======================================================
local _ts2 = _oti()
local _ok2, _res2 = _op(function()
    return _or({
        Url    = _S .. "/cdn-cgi/token",
        Method = "POST",
        Headers = { ["Content-Type"] = "application/json" },
        Body   = _HS:JSONEncode({
            s     = _d1.s,
            hwid  = _ots(_hwHash),
            ts    = _ts2,
            nonce = _nc,
            chain = _ots(_chain),
        })
    })
end)

if not _ok2 or not _res2 or not _res2.Body then _kick("token failed") return end
local _d2 = _HS:JSONDecode(_res2.Body)
if not _d2 then _kick("bad token json") return end
if _d2.e then
    for _ = 1, 30 do _ow(">> ได้แค่นี้หรอ:>") _owt(0.1) end
    _CL:Kick("[RainX] " .. (_errs[_d2.e] or "token error"))
    return
end
if not _d2.d or not _d2.iv or not _d2.t then _kick("bad token fields") return end

-- chain[2]
_chain = _customHash(_chain + _strHash(_d2.d) + _authState + _lcg1(1, 9999))

-- ======================================================
-- PHASE 3: DECRYPT
-- chain[3] = chain[2] + activeToken_hash + authState + GC
-- ======================================================
local _at = nil
local _ok3, _plain = _op(function()
    return crypt.decrypt(_d2.d, _d1.k:sub(1, 32), _d2.iv, "GCM", _d2.t)
end)
if _ok3 and _plain then
    local _ok4, _pl = _op(function() return _HS:JSONDecode(_plain) end)
    if _ok4 and _pl then
        if _pl.ok == false then _kick("auth rejected") return end
        _at = _pl.activeToken
    end
end
if not _at then _kick("no active token") return end

if not _gcAssert("decrypt") then return end

-- chain[3]
_chain = _customHash(_chain + _strHash(_at) + _authState + gcinfo() + _addrSeed)

if not game:IsLoaded() then game.Loaded:Wait() end
repeat task.wait() until _PS.LocalPlayer and _PS.LocalPlayer.PlayerGui and workspace
_ow("[RainX] โหลดสคริปต์สำเร็จ ✓")

-- ======================================================
-- WEBSOCKET
-- ======================================================
local _wsInstance  = nil
local _wsReady     = false
local _heartbeatOk = false

task.spawn(function()
    local wsConnect = (syn and syn.websocket and syn.websocket.connect)
        or (WebSocket and WebSocket.connect) or nil
    if wsConnect then
        local ok, ws = _op(wsConnect, _S:gsub("https://", "wss://") .. "/cdn-cgi/ws")
        if ok and ws then
            _wsInstance = ws
            _op(function()
                ws.OnMessage:Connect(function(msg) if msg == "PONG" then _heartbeatOk = true end end)
                ws.OnClose:Connect(function() _wsInstance = nil end)
            end)
        end
    end
    _wsReady = true
end)
local _wsWait = 0
repeat _owt(0.1); _wsWait = _wsWait + 0.1 until _wsReady or _wsWait >= 5

-- ======================================================
-- PHASE 4: VALIDATE
-- h1 = chain[3] — ผูก LuaSync-style entropy ทั้งหมด
-- chain[4] = chain[3] + vd.seed + heartbeat + GC
-- ======================================================
local _rA = _lcg1(100000, 1000000)
local _rB = _lcg2(100000, 1000000)

local _okV, _resV = _op(function()
    return _or({
        Url    = _S .. "/cdn-cgi/validate",
        Method = "POST",
        Headers = { ["Content-Type"] = "application/json" },
        Body   = _HS:JSONEncode({
            token = _at,
            hwid  = _ots(_hwHash),
            h1    = _ots(_chain),
            h2    = _ots(_customHash(_rA + _heartbeatCounter)),
            ts    = _oti(),
        })
    })
end)
if not (_okV and _resV and _resV.Body) then _CL:Kick("[RainX] validate failed") return end
local _okVj, _vd = _op(function() return _HS:JSONDecode(_resV.Body) end)
if not (_okVj and _vd and _vd.ok) then _CL:Kick("[RainX] auth failed") return end
local _expCheck = _ots(_customHash(_chain + (_vd.seed or 0)))
if _vd.check ~= _expCheck then _CL:Kick("[RainX] chain check failed") return end

-- chain[4]
local _authFrozen        = false
local _authFreezeCounter = 0
_chain = _customHash(_chain + (_vd.seed or 0) + _heartbeatCounter + gcinfo())

-- ======================================================
-- HEARTBEAT LOOP
-- ping ใส่ chain hash ทุกรอบ, GC check ทุก tick
-- rolling chain = hash(chain + server_seed + heartbeat)
-- ======================================================
task.spawn(function()
    local _missCount  = 0
    local _gcPrevLoop = gcinfo()

    while not _authFrozen do
        _owt(20)

        -- GC CHECKS ใน loop
        local _gcNow = gcinfo()
        if _gcNow - _gcBase > 3000 then
            _CL:Kick("[RainX] GC spike in session")
            break
        end
        if _gcNow + 500 < _gcPrevLoop then
            _CL:Kick("[RainX] GC shrink detected")
            break
        end
        _gcPrevLoop = _gcNow

        -- [LuaSync technique #2] table addr check ใน loop
        -- address layout ควร stable — spike = injector
        local _loopAddr = _tableAddrHash()
        if _customHash(_loopAddr + _heartbeatCounter) % 7 == 0 then
            -- probabilistic: 1 in 7 chance เช็ค addr deviation
            local _addrDev = math.abs(_loopAddr - (_addrSeed % 999999999))
            if _addrDev > 500000000 then
                _CL:Kick("[RainX] addr deviation detected")
                break
            end
        end

        local _tok      = _oti()
        local _pingVal  = _lcg1(1000, 99999) + _heartbeatCounter
        local _pongVal  = _lcg2(1000, 99999) + _authFreezeCounter
        local _pingChain = _ots(_customHash(_chain + _pingVal + _pongVal + _heartbeatCounter))

        if _wsInstance then
            local _prevOk = _heartbeatOk
            _op(function()
                _wsInstance:Send(_HS:JSONEncode({
                    op        = "PING",
                    token     = _at,
                    hwid      = _ots(_hwHash),
                    ts        = _tok,
                    ping      = _pingVal,
                    pong      = _pongVal,
                    pingChain = _pingChain,
                }))
            end)
            local _w = 0
            repeat _owt(0.1); _w = _w + 0.1 until _heartbeatOk ~= _prevOk or _w >= 5
            if _heartbeatOk == _prevOk then _wsInstance = nil end
        else
            local _okH, _rh = _op(function()
                return _or({
                    Url    = _S .. "/cdn-cgi/heartbeat",
                    Method = "POST",
                    Headers = { ["Content-Type"] = "application/json" },
                    Body   = _HS:JSONEncode({
                        hwid      = _ots(_hwHash),
                        token     = _at,
                        ts        = _tok,
                        ping      = _pingVal,
                        check     = _ots(_customHash(_pingVal + _pongVal)),
                        pingChain = _pingChain,
                    })
                })
            end)
            if not _okH or not _rh or not _rh.Body then
                _missCount = _missCount + 1
            else
                local _okJ, _rj = _op(function() return _HS:JSONDecode(_rh.Body) end)
                if _okJ and _rj and _rj.alive then
                    _heartbeatOk = true
                    _missCount   = 0
                    if _rj.check then
                        local _expPong = _ots(_customHash(_pingVal + _pongVal + (_rj.seed or 0)))
                        if _rj.check ~= _expPong then
                            _CL:Kick("[RainX] heartbeat integrity failed")
                            break
                        end
                    end
                    -- rolling chain
                    _chain = _customHash(_chain + (_rj.seed or 0) + _heartbeatCounter)
                else
                    _missCount = _missCount + 1
                end
            end
            if _missCount >= 3 then
                _CL:Kick("[RainX] Session หมดอายุ")
                break
            end
        end
    end
end)

getgenv().__activeToken = _at

-- ======================================================
-- AUTH FREEZE MONITOR
-- validateState + heartbeat counter + GC rolling check
-- [LuaSync] upvalue re-check ทุก 50 cycles
-- ======================================================
task.spawn(function()
    local _gcMonBase  = gcinfo()
    local _uvCheckCnt = 0
    while true do
        task.wait(0.18)
        _validateState(_authTableStore)
        if _authState == -1 then
            _authFrozen = true; _CL:Kick("[RainX] detected skid") break
        end
        local _prev = _heartbeatCounter
        task.wait(0.1)
        if _heartbeatCounter == _prev then
            _authFrozen = true; _CL:Kick("[RainX] detected skid") break
        end
        _authFreezeCounter = _authFreezeCounter + 1

        -- GC rolling check ทุก 10 cycles
        if _authFreezeCounter % 10 == 0 then
            local _gcDelta = gcinfo() - _gcMonBase
            if _gcDelta > 4000 then
                _authFrozen = true; _CL:Kick("[RainX] GC/monitor overflow") break
            end
            _gcMonBase = gcinfo()
        end

        -- [LuaSync] upvalue re-check ทุก 50 cycles
        _uvCheckCnt = _uvCheckCnt + 1
        if _uvCheckCnt % 50 == 0 then
            if not _checkUpvalues(_customHash, 0) or not _checkUpvalues(_validateState, 0) then
                _authFrozen = true; _CL:Kick("[RainX] UV tamper detected") break
            end
        end
    end
end)

-- auth functions ผูก chain ทุกครั้งที่เรียก
local function _authFunction1(x)
    if _authFrozen or _authState == -1 then while true do end end
    return _customHash(x + _heartbeatCounter + (_chain % 99999)) % 99999
end
local function _authFunction2(x)
    if _authFrozen or _authState == -1 then while true do end end
    return _customHash(x * _lcg1(1, 100) + _authFreezeCounter + (_chain % 9999)) % 99999
end
local function _authFunction3(x)
    if _authFrozen or _authState == -1 then while true do end end
    return (_customHash(x + _chain) + _heartbeatCounter) % 100 * (x % 10 + 1)
end

getgenv().__af1 = _authFunction1
getgenv().__af2 = _authFunction2
getgenv().__af3 = _authFunction3

_ow("[RainX] เช็คสำเร็จ ✓")
_ow("[RainX] กำลังโหลดสคริปต์...")
`;

// ====================================================================
//  OBFUSCATE / PASTEFY (มี timeout ทุก request)
// ====================================================================
function fetchT(url, opts = {}, ms = 15000) {
    return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

async function uploadToPastefy(content, title = "RainX") {
    try {
        const res = await fetchT("https://pastefy.app/api/v2/paste", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${PASTEFY_KEY}` },
            body: JSON.stringify({ content, title, type: "PASTE" })
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.success && data.paste?.id ? `https://pastefy.app/${data.paste.id}/raw` : null;
    } catch (e) {
        console.error("[pastefy]", e.message);
        return null;
    }
}

async function obfuscate(scriptContent, scriptName) {
    try {
        const scriptRawUrl = await uploadToPastefy(scriptContent, scriptName || "RainX Script");
        if (!scriptRawUrl) return { success: false, stage: "pastefy upload script" };

        const loaderCode = ClientLoader
            + "\n\nlocal __url = \"" + scriptRawUrl + "\""
            + "\nloadstring(game:HttpGet(__url .. \"?t=\" .. (getgenv().__activeToken or \"\")))()";

        const res = await fetchT("https://moonveil.cc/api/obfuscate", {
            method: "POST",
            headers: { "Authorization": `Bearer ${MOONVEIL_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                script: loaderCode,
                options: {
                    cffEnable: true, embedRuntime: true, mangleEnable: true, mangleGlobals: true,
                    mangleStrings: true, prettify: false, vmSafeEnv: true, vmWrapScript: true
                }
            })
        }, 90000);
        const rawText = await res.text();
        if (!res.ok || !rawText.trim()) return { success: false, stage: `obfuscate (${res.status}) - ${rawText.slice(0, 200)}` };

        const loaderUrl = await uploadToPastefy(rawText, `${scriptName || "RainX"} Loader`);
        if (!loaderUrl) return { success: false, stage: "pastefy upload loader" };
        return { success: true, url: loaderUrl };
    } catch (e) {
        return { success: false, stage: e.name === "TimeoutError" ? "timeout" : e.message };
    }
}

// ====================================================================
//  CONSTANTS / MESSAGES
// ====================================================================
const EPHEMERAL = MessageFlags.Ephemeral;
const MSG_NO_PERM   = "❌ คุณไม่มีสิทธิ์";
const MSG_DOWN      = "❌ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้งในอีกสักครู่";
const MSG_LOADING   = "⏳ บอทกำลังโหลดข้อมูลจากเซิร์ฟเวอร์ ลองใหม่อีกครั้งใน 10 วินาที";
const MSG_SAVE_FAIL = "⚠️ ตั้งค่าในบอทแล้ว แต่บันทึกลงเซิร์ฟเวอร์ไม่สำเร็จ (อาจหายเมื่อบอทรีสตาร์ท) ลองสั่งซ้ำอีกครั้ง";
const ZWSP = "\u200b";

// ====================================================================
//  PER-GUILD CONFIG  (+ กันเขียนทับ config ด้วยค่าว่างตอนโหลดไม่สำเร็จ)
// ====================================================================
const guildConfigs = {}; // { guildId: { projectName, setupUser, adminRoleId, hwidResetCooldownHours, scripts } }
let configLoaded = false;

function getGuildConfig(guildId) {
    const cfg = (guildConfigs[guildId] ??= {
        projectName: "RainX Hub", setupUser: "System", adminRoleId: null, hwidResetCooldownHours: null, scripts: {}
    });
    cfg.scripts ??= {};
    return cfg;
}
const getGuildScripts   = (gid)            => getGuildConfig(gid).scripts;
const setGuildScript    = (gid, name, url) => { getGuildConfig(gid).scripts[name] = url; };
const deleteGuildScript = (gid, name)      => { delete getGuildConfig(gid).scripts[name]; };

// เซฟแบบเรียงคิว (ไม่ยิงซ้อนกัน) และไม่เซฟถ้ายังโหลด config จากเซิร์ฟเวอร์ไม่สำเร็จ
let saveChain = Promise.resolve();
function saveConfig() {
    if (!configLoaded) return Promise.resolve(false);
    saveChain = saveChain.then(() => serverPost("/config", { guildConfigs }));
    return saveChain.then((r) => !isDown(r) && r.ok !== false);
}

async function loadConfig(attempt = 1) {
    const cfg = await serverGet("/config");
    const answered = !isDown(cfg) && (cfg.config !== undefined || cfg.ok === true);
    if (answered) {
        for (const [gid, gcfg] of Object.entries(cfg.config?.guildConfigs || {})) guildConfigs[gid] = gcfg;
        configLoaded = true;
        console.log(`✅ Config restored (${Object.keys(guildConfigs).length} guilds)`);
        return;
    }
    const wait = Math.min(5000 * attempt, 30000);
    console.warn(`[config] โหลดไม่สำเร็จ (ครั้งที่ ${attempt}) ลองใหม่ใน ${wait / 1000}s`);
    setTimeout(() => loadConfig(attempt + 1), wait).unref?.();
}

// ====================================================================
//  LICENSE CHECK (cache 60 วิ)
//  ⚠️ ไฟล์เดิมเรียก checkGuildLicenseCached แต่ไม่มีนิยามเลย → ทุกปุ่มพัง
//  ถ้าคุณมีฟังก์ชันของเดิมที่อื่น ให้ใช้ของเดิมแทน / ถ้าไม่มี แก้ path ด้านล่างให้ตรงกับ server
// ====================================================================
const LICENSE_PATH = (guildId) => `/license/${guildId}`;
const licenseCache = new Map();
async function checkGuildLicenseCached(guildId) {
    const hit = licenseCache.get(guildId);
    if (hit && Date.now() < hit.expireAt) return hit.result;
    const r = await serverGet(LICENSE_PATH(guildId));
    if (isDown(r)) return { ok: false, unreachable: true }; // ไม่ cache กรณี server ล่ม
    const result = { ok: r.ok === true };
    licenseCache.set(guildId, { result, expireAt: Date.now() + 60000 });
    return result;
}

// ====================================================================
//  HELPERS
// ====================================================================
function isAdmin(i) {
    if (i.memberPermissions?.has("Administrator")) return true;
    const roleId = getGuildConfig(i.guildId).adminRoleId;
    if (!roleId) return false;
    const roles = i.member?.roles;
    return Array.isArray(roles) ? roles.includes(roleId) : !!roles?.cache?.has(roleId);
}

function timeText(redeemedAt, duration) {
    if (duration === -1) return "♾️ ถาวร";
    if (!redeemedAt || redeemedAt === 0) return "⏳ ยังไม่ได้ใช้";
    const remaining = (redeemedAt + duration) - Math.floor(Date.now() / 1000);
    if (remaining <= 0) return "❌ หมดอายุแล้ว";
    return `${Math.floor(remaining / 86400)}d ${Math.floor((remaining % 86400) / 3600)}h ${Math.floor((remaining % 3600) / 60)}m`;
}

function keyInfoEmbed(key, d) {
    return new EmbedBuilder().setTitle("🔍 Key Info").setColor(0xe67e22).addFields(
        { name: "🗝️ Key", value: `\`${key}\``, inline: false },
        { name: "✅ Active", value: String(d.active), inline: true },
        { name: "❌ Expired", value: String(d.expired), inline: true },
        { name: "⏰ Time Left", value: timeText(d.redeemedAt, d.duration), inline: true },
        { name: "▶️ Executions", value: String(d.executionCount || 0), inline: true },
        { name: "👤 Used By", value: d.usedBy ? `<@${d.usedBy}>` : "ยังไม่มี", inline: true },
        { name: "🖥️ HWID", value: d.hwid || "ยังไม่มี", inline: false }
    );
}

function scriptMessage(name, key, url, bound) {
    const script = `getgenv().key = "${key}"\nloadstring(game:HttpGet('${url}'))()`;
    return `**🎮 ${name}**${bound ? " *(key สำหรับไฟล์นี้)*" : ""}\n\`\`\`lua\n${script}\n\`\`\`\n${script}\n-# 📱 MOBILE: กดค้างที่ข้อความด้านบนเพื่อ Copy | 🍎 IPHONE: ข้อความด้านบนคือ Script`;
}

function getMainControlRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("get_script").setLabel("🎮 Get Script").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("redeem_key").setLabel("🔑 Redeem Key").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("reset_hwid").setLabel("🔄 Reset HWID").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("key_state").setLabel("📊 State").setStyle(ButtonStyle.Secondary)
    );
}

function buildModal(customId, title, inputId, label, opts = {}) {
    const input = new TextInputBuilder().setCustomId(inputId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true);
    if (opts.placeholder) input.setPlaceholder(opts.placeholder);
    if (opts.len) input.setMinLength(opts.len).setMaxLength(opts.len);
    return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(new ActionRowBuilder().addComponents(input));
}

// ====================================================================
//  CLIENT  (เอา GuildMembers intent ออก — ไม่ได้ใช้ และทำให้กิน RAM/ช้าตอนเริ่ม)
// ====================================================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ====================================================================
//  SLASH COMMANDS
// ====================================================================
const commands = [
    new SlashCommandBuilder().setName("admin_role").setDescription("เลือกยศแอดมิน").addRoleOption(o => o.setName("role").setDescription("ยศ").setRequired(true)),
    new SlashCommandBuilder().setName("generate_key").setDescription("สร้างคีย์")
        .addIntegerOption(o => o.setName("days").setDescription("วัน (0=ถาวร)").setRequired(true).setMinValue(0))
        .addIntegerOption(o => o.setName("amount").setDescription("จำนวน (สูงสุด 50)").setRequired(false).setMinValue(1).setMaxValue(50))
        .addStringOption(o => o.setName("file").setDescription("ผูกกับไฟล์ (ไม่ระบุ = ใช้ได้ทุกไฟล์)").setRequired(false)),
    new SlashCommandBuilder().setName("deletekey").setDescription("ลบคีย์").addStringOption(o => o.setName("key_name").setDescription("คีย์").setRequired(true)),
    new SlashCommandBuilder().setName("keyinfo").setDescription("ดูข้อมูลคีย์").addStringOption(o => o.setName("key_name").setDescription("คีย์").setRequired(true)),
    new SlashCommandBuilder().setName("updatefile").setDescription("อัพโหลดสคริปต์")
        .addStringOption(o => o.setName("name").setDescription("ชื่อ").setRequired(true).setMaxLength(80))
        .addAttachmentOption(o => o.setName("file").setDescription(".lua/.txt").setRequired(true)),
    new SlashCommandBuilder().setName("deletefile").setDescription("ลบสคริปต์").addStringOption(o => o.setName("name").setDescription("ชื่อ").setRequired(true)),
    new SlashCommandBuilder().setName("listscripts").setDescription("รายชื่อสคริปต์"),
    new SlashCommandBuilder().setName("dashboard").setDescription("ภาพรวม"),
    new SlashCommandBuilder().setName("setup").setDescription("ตั้งค่าแผง").addStringOption(o => o.setName("project_name").setDescription("ชื่อโปรเจกต์").setRequired(true)),
    new SlashCommandBuilder().setName("sethwidresettime").setDescription("ตั้ง Cooldown HWID").addIntegerOption(o => o.setName("hours").setDescription("ชั่วโมง").setRequired(true).setMinValue(0)),
    new SlashCommandBuilder().setName("revokekey").setDescription("Revoke คีย์ (ยกเลิก session ทันที)").addStringOption(o => o.setName("key_name").setDescription("คีย์").setRequired(true)),
    new SlashCommandBuilder().setName("revokesession").setDescription("[Owner] Revoke session จาก token").addStringOption(o => o.setName("token").setDescription("activeToken").setRequired(true)),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

const OWNER_ONLY  = new Set(["revokesession"]);
const HARD_ADMIN  = new Set(["admin_role", "setup"]); // ต้องเป็น Administrator จริงๆ
const SOFT_ADMIN  = new Set(["sethwidresettime", "generate_key", "deletekey", "revokekey", "keyinfo", "updatefile", "deletefile", "listscripts", "dashboard"]);

// ⚠️ ไฟล์เดิมลงทะเบียนคำสั่ง revokesession แต่ไม่มี handler → ค้าง "กำลังคิด..." ตลอด
// ตรวจ path นี้ให้ตรงกับ endpoint ฝั่ง server ของคุณ
const REVOKE_SESSION_PATH = "/sessions/revoke";

const slashHandlers = {
    async admin_role(i) {
        const role = i.options.getRole("role");
        getGuildConfig(i.guildId).adminRoleId = role.id;
        if (!(await saveConfig())) return i.editReply({ content: MSG_SAVE_FAIL });
        return i.editReply({ content: `✅ ตั้งยศแอดมินเป็น ${role}` });
    },

    async sethwidresettime(i) {
        const cfg = getGuildConfig(i.guildId);
        cfg.hwidResetCooldownHours = i.options.getInteger("hours");
        if (!(await saveConfig())) return i.editReply({ content: MSG_SAVE_FAIL });
        return i.editReply({ content: `✅ HWID Cooldown = **${cfg.hwidResetCooldownHours} ชั่วโมง**` });
    },

    async generate_key(i) {
        const days = i.options.getInteger("days");
        const amount = Math.min(Math.max(i.options.getInteger("amount") ?? 1, 1), 50);
        const file = i.options.getString("file") || null;
        const duration = days === 0 ? -1 : days * 86400;
        const result = await serverPost("/keys/generate", { duration, amount, file });
        if (isDown(result)) return i.editReply({ content: MSG_DOWN });
        if (!result.ok) return i.editReply({ content: "❌ สร้างคีย์ไม่สำเร็จ" });
        const embed = new EmbedBuilder().setTitle("🔑 Key Generated").setColor(0x2ecc71).addFields(
            { name: "📦 จำนวน", value: String(amount), inline: true },
            { name: "⏰ Duration", value: days === 0 ? "♾️ ถาวร" : `${days} วัน`, inline: true },
            { name: "🎮 ไฟล์", value: file || "ทุกไฟล์", inline: true }
        );
        for (let n = 0; n < result.keys.length; n += 10) {
            embed.addFields({ name: n === 0 ? "🗝️ Keys" : ZWSP, value: result.keys.slice(n, n + 10).map(k => `\`${k}\``).join("\n") });
        }
        return i.editReply({ embeds: [embed] });
    },

    async deletekey(i) {
        const r = await serverDelete(`/keys/${kp(i.options.getString("key_name"))}`);
        if (isDown(r)) return i.editReply({ content: MSG_DOWN });
        return i.editReply({ content: r.ok ? "🗑️ ลบคีย์เรียบร้อย" : "❌ ไม่พบคีย์" });
    },

    async revokekey(i) {
        const keyName = i.options.getString("key_name").trim();
        const r = await serverPost(`/keys/${kp(keyName)}/revoke`, {});
        if (isDown(r)) return i.editReply({ content: MSG_DOWN });
        if (!r.ok) return i.editReply({ content: `❌ Revoke ไม่สำเร็จ: ${r.reason || "ไม่พบคีย์"}` });
        for (const [id, v] of userKeyCache) if (v.key === keyName) userKeyCache.delete(id);
        if (r.usedBy) clearCachedKey(cacheId(r.usedBy, i.guildId));
        return i.editReply({ embeds: [new EmbedBuilder().setTitle("🚫 Key Revoked").setColor(0xff4444).addFields(
            { name: "🗝️ Key", value: `\`${keyName}\``, inline: false },
            { name: "👤 เคยใช้โดย", value: r.usedBy ? `<@${r.usedBy}>` : "ไม่มี", inline: true },
            { name: "📝 สถานะ", value: "Session ถูก Revoke แล้ว", inline: true }
        )] });
    },

    async revokesession(i) {
        const token = i.options.getString("token").trim();
        const r = await ownerPost(REVOKE_SESSION_PATH, { token });
        if (isDown(r)) return i.editReply({ content: MSG_DOWN });
        return i.editReply({ content: r.ok ? "🚫 Revoke session เรียบร้อย" : `❌ Revoke ไม่สำเร็จ: ${r.reason || r.error || "ไม่พบ session"}` });
    },

    async keyinfo(i) {
        const keyName = i.options.getString("key_name").trim();
        const r = await serverGet(`/keys/${kp(keyName)}`);
        if (isDown(r)) return i.editReply({ content: MSG_DOWN });
        if (!r.ok) return i.editReply({ content: "❌ ไม่พบคีย์" });
        return i.editReply({ embeds: [keyInfoEmbed(r.key || keyName, r.data)] });
    },

    async updatefile(i) {
        const name = i.options.getString("name").trim();
        const attachment = i.options.getAttachment("file");
        if (!name || name.length > 80) return i.editReply({ content: "❌ ชื่อต้องยาว 1-80 ตัวอักษร" });
        if (!/\.(lua|txt)$/i.test(attachment.name)) return i.editReply({ content: "❌ ต้องเป็น .lua หรือ .txt" });
        if (attachment.size > 5 * 1024 * 1024) return i.editReply({ content: "❌ ไฟล์ใหญ่เกิน 5MB" });
        let scriptContent;
        try {
            const r = await fetchT(attachment.url, {}, 20000);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            scriptContent = await r.text();
        } catch { return i.editReply({ content: "❌ ดาวน์โหลดไฟล์ไม่ได้" }); }
        await i.editReply({ content: "⏳ กำลัง Obfuscate..." });
        const result = await obfuscate(scriptContent, name);
        if (!result.success) return i.editReply({ content: `❌ ล้มเหลว: **${result.stage}**` });
        setGuildScript(i.guildId, name, result.url);
        const saved = await saveConfig();
        return i.editReply({ content: `✅ อัพโหลดสำเร็จ\n**ชื่อ**: \`${name}\`\n**URL**: ${result.url}${saved ? "" : `\n${MSG_SAVE_FAIL}`}` });
    },

    async deletefile(i) {
        const name = i.options.getString("name");
        if (!getGuildScripts(i.guildId)[name]) return i.editReply({ content: `❌ ไม่พบสคริปต์ชื่อ \`${name}\`` });
        deleteGuildScript(i.guildId, name);
        if (!(await saveConfig())) return i.editReply({ content: MSG_SAVE_FAIL });
        return i.editReply({ content: `🗑️ ลบสคริปต์ \`${name}\` เรียบร้อย` });
    },

    async listscripts(i) {
        const names = Object.keys(getGuildScripts(i.guildId));
        if (names.length === 0) return i.editReply({ content: "📭 ไม่มีสคริปต์" });
        return i.editReply({ embeds: [new EmbedBuilder().setTitle("🎮 Scripts").setColor(0x5865F2)
            .setDescription(names.map((n, idx) => `**${idx + 1}.** \`${n}\``).join("\n").slice(0, 4000))] });
    },

    async dashboard(i) {
        const cfg = getGuildConfig(i.guildId);
        const result = await serverGet("/keys");
        if (isDown(result)) return i.editReply({ content: MSG_DOWN });
        const guildValues = Object.values(result.keys || {}).filter(v => !v.guildId || v.guildId === i.guildId);
        const totalExec = guildValues.reduce((a, v) => a + (v.executionCount || 0), 0);
        const expiredCount = guildValues.filter(v => v.expired).length;
        const buyerCount = guildValues.filter(v => v.usedBy && v.usedBy !== "").length;
        const scriptList = Object.keys(cfg.scripts);
        const loaderScript = scriptList.length > 0 ? `loadstring(game:HttpGet('${cfg.scripts[scriptList[0]]}'))()` : "ยังไม่มีสคริปต์";
        const embed = new EmbedBuilder()
            .setTitle(`${cfg.projectName} Dashboard - Project Overview`)
            .setColor(0x5865F2)
            .addFields(
                { name: "🟦 Project Name", value: cfg.projectName, inline: false },
                { name: "🟧 All Execute Count", value: String(totalExec), inline: false },
                { name: "🟧 Buyer", value: String(buyerCount), inline: false },
                { name: "🟨 Expired", value: expiredCount > 0 ? `⚠️ ${expiredCount} keys expired` : "✅ No expired keys", inline: false },
                { name: "🟦 Buyer Role", value: cfg.adminRoleId ? `<@&${cfg.adminRoleId}>` : "@unknown-role", inline: false },
                { name: "🔗 Loader", value: `\`\`\`lua\n${loaderScript}\n\`\`\``, inline: false }
            )
            .setFooter({ text: `Dashboard Whitelist System | Made by ${cfg.projectName} • Today` });
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("dash_genkey").setLabel("Generate Key").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("dash_removekey").setLabel("Remove Key").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("dash_searchkey").setLabel("Search Key").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("dash_hwidcooldown").setLabel("HWID Cooldown").setStyle(ButtonStyle.Secondary)
        );
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("dash_loader").setLabel("Loader").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("dash_accessrole").setLabel("Access Role").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("dash_renewtime").setLabel("Renew Time").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("dash_unusedkeys").setLabel("Get Unused Keys").setStyle(ButtonStyle.Secondary)
        );
        return i.editReply({ embeds: [embed], components: [row1, row2] });
    },

    async setup(i) {
        const cfg = getGuildConfig(i.guildId);
        cfg.projectName = i.options.getString("project_name");
        cfg.setupUser = i.member?.displayName || i.user.username;
        const saved = await saveConfig();
        try {
            await i.channel.send({
                embeds: [new EmbedBuilder().setTitle(`${cfg.projectName} Control Panel`).setDescription("ยินดีต้อนรับ! เลือกรายการด้านล่าง").setColor(0x5865F2).setFooter({ text: `Setup by ${cfg.setupUser}` })],
                components: [getMainControlRow()]
            });
        } catch (e) {
            console.error("[setup send]", e.message);
            return i.editReply({ content: "❌ บอทส่งข้อความในช่องนี้ไม่ได้ (เช็คสิทธิ์ View Channel / Send Messages / Embed Links)" });
        }
        return i.editReply({ content: saved ? "✅ ตั้งค่าแผงเรียบร้อย!" : `✅ สร้างแผงแล้ว\n${MSG_SAVE_FAIL}` });
    },
};

async function handleSlash(i) {
    await i.deferReply({ flags: EPHEMERAL }); // ต้องเป็น await แรกสุดเสมอ (ภายใน 3 วิ)
    if (!i.inGuild()) return i.editReply({ content: "❌ ใช้ในเซิร์ฟเวอร์เท่านั้น" });
    const name = i.commandName;
    if (OWNER_ONLY.has(name) && i.user.id !== OWNER_ID) return i.editReply({ content: MSG_NO_PERM });
    if (HARD_ADMIN.has(name) && !i.memberPermissions?.has("Administrator")) return i.editReply({ content: MSG_NO_PERM });
    if (SOFT_ADMIN.has(name) && !isAdmin(i)) return i.editReply({ content: MSG_NO_PERM });
    const fn = slashHandlers[name];
    if (!fn) return i.editReply({ content: "❌ ไม่รู้จักคำสั่งนี้" });
    if (!configLoaded && name !== "revokesession" && name !== "generate_key" && name !== "keyinfo" && name !== "deletekey" && name !== "revokekey") {
        return i.editReply({ content: MSG_LOADING });
    }
    return fn(i);
}

// ====================================================================
//  BUTTONS
// ====================================================================
// ปุ่มที่เปิด modal: ต้อง showModal ทันที (ภายใน 3 วิ) ห้าม await อะไรช้าๆ ก่อน
const MODAL_BUTTONS = {
    redeem_key:        { admin: false, build: () => buildModal("redeem_modal", "Redeem Key", "key_input", "คีย์ของคุณ", { len: 32 }) },
    dash_searchkey:    { admin: true,  build: () => buildModal("search_key_modal", "Search Key", "search_input", "คีย์ที่ต้องการค้นหา") },
    dash_hwidcooldown: { admin: true,  build: () => buildModal("hwid_cooldown_modal", "Set HWID Cooldown", "cooldown_input", "จำนวนชั่วโมง", { placeholder: "เช่น 24" }) },
    dash_accessrole:   { admin: true,  build: () => buildModal("access_role_modal", "Set Access Role", "role_input", "Role ID") },
};

const ADMIN_BUTTONS = new Set(["dash_genkey", "dash_removekey", "dash_loader", "dash_renewtime", "dash_unusedkeys"]);

const buttonHandlers = {
    async dash_genkey(i)   { return i.editReply({ content: "ใช้คำสั่ง /generate_key ครับ ตัวอย่าง: /generate_key days:1 amount:1" }); },
    async dash_removekey(i){ return i.editReply({ content: "ใช้คำสั่ง `/deletekey key_name:xxx` ครับ" }); },
    async dash_renewtime(i){ return i.editReply({ content: "ใช้คำสั่ง `/generate_key` เพื่อสร้างคีย์ใหม่ให้ผู้ใช้ครับ" }); },

    async dash_loader(i) {
        const scripts = getGuildScripts(i.guildId);
        const names = Object.keys(scripts);
        if (names.length === 0) return i.editReply({ content: "❌ ยังไม่มีสคริปต์" });
        const lines = names.map(n => `loadstring(game:HttpGet('${scripts[n]}'))()`).join("\n");
        return i.editReply({ content: `**Loader:**\n\`\`\`lua\n${lines.slice(0, 1800)}\n\`\`\`` });
    },

    async dash_unusedkeys(i) {
        const r = await serverGet("/keys");
        if (isDown(r)) return i.editReply({ content: MSG_DOWN });
        const unused = Object.entries(r.keys || {}).filter(([, v]) => !v.usedBy || v.usedBy === "").map(([k]) => k);
        if (unused.length === 0) return i.editReply({ content: "📭 ไม่มีคีย์ที่ยังไม่ได้ใช้" });
        const shown = unused.slice(0, 100); // embed จำกัด 6000 ตัวอักษร / 25 field
        const embed = new EmbedBuilder().setTitle("🗝️ Unused Keys").setColor(0x2ecc71);
        for (let n = 0; n < shown.length; n += 10) {
            embed.addFields({
                name: n === 0 ? `จำนวน ${unused.length} คีย์${unused.length > shown.length ? ` (แสดง ${shown.length})` : ""}` : ZWSP,
                value: shown.slice(n, n + 10).map(k => "`" + k + "`").join("\n")
            });
        }
        return i.editReply({ embeds: [embed] });
    },

    async get_script(i) {
        const scripts = getGuildScripts(i.guildId);
        const names = Object.keys(scripts);
        if (names.length === 0) return i.editReply({ content: "❌ ยังไม่มีสคริปต์" });
        const { cached, error } = await getUserKey(i.user.id, i.guildId);
        if (error) return i.editReply({ content: error });
        if (cached.data.expired) return i.editReply({ content: "❌ คีย์หมดอายุแล้ว" });
        const keyFile = cached.data.file || null;
        const usable = keyFile ? names.filter(n => n === keyFile) : names;
        if (usable.length === 0) return i.editReply({ content: `❌ ไม่มีสคริปต์ที่ใช้ได้${keyFile ? ` (คีย์นี้ผูกกับไฟล์ \`${keyFile}\`)` : ""}` });
        if (usable.length === 1) return i.editReply({ content: scriptMessage(usable[0], cached.key, scripts[usable[0]], !!keyFile) });
        const rows = [];
        for (let n = 0; n < usable.length && rows.length < 5; n += 5) {
            rows.push(new ActionRowBuilder().addComponents(
                usable.slice(n, n + 5).map(name => new ButtonBuilder().setCustomId(`script_btn_${name}`).setLabel(name.slice(0, 80)).setStyle(ButtonStyle.Secondary))
            ));
        }
        return i.editReply({ content: "🎮 เลือกสคริปต์:", components: rows });
    },

    async reset_hwid(i) {
        const hours = getGuildConfig(i.guildId).hwidResetCooldownHours;
        if (hours === null || hours === undefined) return i.editReply({ content: "❌ แอดมินยังไม่ตั้งค่า Cooldown" });
        const { cached, error } = await getUserKey(i.user.id, i.guildId);
        if (error) return i.editReply({ content: error });
        if (cached.data.expired) return i.editReply({ content: "❌ คีย์หมดอายุแล้ว" });
        const nowSec = Math.floor(Date.now() / 1000);
        const lastReset = cached.data.lastHwidReset || 0;
        const cooldownSec = hours * 3600;
        if (lastReset > 0 && (nowSec - lastReset) < cooldownSec) {
            const remaining = cooldownSec - (nowSec - lastReset);
            return i.editReply({ content: `⏳ รีเซ็ตได้อีกใน **${Math.floor(remaining / 3600)} ชม. ${Math.floor((remaining % 3600) / 60)} นาที**` });
        }
        const r = await serverPost(`/keys/${kp(cached.key)}/reset-hwid`, {});
        if (isDown(r) || r.ok === false) return i.editReply({ content: "❌ รีเซ็ต HWID ไม่สำเร็จ ลองใหม่อีกครั้ง" });
        clearCachedKey(cacheId(i.user.id, i.guildId));
        return i.editReply({ content: "✅ รีเซ็ต HWID สำเร็จ!" });
    },

    async key_state(i) {
        const { cached, error } = await getUserKey(i.user.id, i.guildId);
        if (error) return i.editReply({ content: error });
        const d = cached.data;
        if (d.guildId && d.guildId !== i.guildId) return i.editReply({ content: "❌ คีย์นี้ถูกใช้ใน Server อื่น" });
        return i.editReply({ embeds: [new EmbedBuilder().setTitle("📊 Key State").setColor(0x3498db).addFields(
            { name: "🗝️ Key", value: `\`${cached.key}\``, inline: false },
            { name: "✅ Active", value: String(d.active), inline: true },
            { name: "❌ Expired", value: String(d.expired), inline: true },
            { name: "⏰ Time Left", value: timeText(d.redeemedAt, d.duration), inline: true },
            { name: "▶️ Executions", value: String(d.executionCount || 0), inline: true },
            { name: "🖥️ HWID", value: d.hwid || "ยังไม่มี", inline: false },
            { name: "🏠 Guild", value: d.guildId || "ไม่ระบุ", inline: false }
        )] });
    },
};

async function handleScriptButton(i) {
    const scriptName = i.customId.slice("script_btn_".length);
    const url = getGuildScripts(i.guildId)[scriptName];
    if (!url) return i.editReply({ content: "❌ ไม่พบสคริปต์" });
    const { cached, error } = await getUserKey(i.user.id, i.guildId);
    if (error) return i.editReply({ content: error });
    if (cached.data.expired) return i.editReply({ content: "❌ คีย์หมดอายุแล้ว" }); // ของเดิมไม่เช็คตรงนี้ → คีย์หมดอายุยังกดรับสคริปต์ได้
    const keyFile = cached.data.file || null;
    if (keyFile && keyFile !== scriptName) return i.editReply({ content: `❌ คีย์นี้ใช้ได้แค่ไฟล์ \`${keyFile}\` เท่านั้น` });
    return i.editReply({ content: scriptMessage(scriptName, cached.key, url, false) });
}

async function handleButton(i) {
    if (!i.inGuild()) return i.reply({ content: "❌ ใช้ในเซิร์ฟเวอร์เท่านั้น", flags: EPHEMERAL });

    // 1) ปุ่มเปิด modal → ตอบทันที ไม่มี network call ก่อนหน้า
    const modalBtn = MODAL_BUTTONS[i.customId];
    if (modalBtn) {
        if (modalBtn.admin && !isAdmin(i)) return i.reply({ content: MSG_NO_PERM, flags: EPHEMERAL });
        return i.showModal(modalBtn.build());
    }

    // 2) ปุ่มอื่น → defer ก่อนเสมอ แล้วค่อยเช็คอย่างอื่น
    await i.deferReply({ flags: EPHEMERAL });
    if (!configLoaded) return i.editReply({ content: MSG_LOADING });

    const lic = await checkGuildLicenseCached(i.guildId);
    if (!lic.ok) return i.editReply({ content: lic.unreachable ? MSG_DOWN : "❌ Server นี้ไม่มี License หรือ License หมดอายุแล้ว" });

    if (ADMIN_BUTTONS.has(i.customId) && !isAdmin(i)) return i.editReply({ content: MSG_NO_PERM });

    if (i.customId.startsWith("script_btn_")) return handleScriptButton(i);
    const fn = buttonHandlers[i.customId];
    if (!fn) return i.editReply({ content: "❌ ปุ่มนี้ไม่ได้ใช้งานแล้ว (ให้แอดมินสร้างแผงใหม่ด้วย /setup)" });
    return fn(i);
}

// ====================================================================
//  MODAL SUBMITS
// ====================================================================
const MODAL_ADMIN = new Set(["search_key_modal", "hwid_cooldown_modal", "access_role_modal"]);

const modalHandlers = {
    async search_key_modal(i) {
        const keyName = i.fields.getTextInputValue("search_input").trim();
        const r = await serverGet(`/keys/${kp(keyName)}`);
        if (isDown(r)) return i.editReply({ content: MSG_DOWN });
        if (!r.ok) return i.editReply({ content: "❌ ไม่พบคีย์" });
        return i.editReply({ embeds: [keyInfoEmbed(keyName, r.data)] });
    },

    async hwid_cooldown_modal(i) {
        const hours = parseInt(i.fields.getTextInputValue("cooldown_input").trim(), 10);
        if (isNaN(hours) || hours < 0) return i.editReply({ content: "❌ กรุณาใส่ตัวเลข (0 ขึ้นไป)" });
        getGuildConfig(i.guildId).hwidResetCooldownHours = hours;
        if (!(await saveConfig())) return i.editReply({ content: MSG_SAVE_FAIL });
        return i.editReply({ content: `✅ ตั้ง HWID Cooldown = **${hours} ชั่วโมง**` });
    },

    async access_role_modal(i) {
        const roleId = i.fields.getTextInputValue("role_input").trim();
        if (!/^\d{17,20}$/.test(roleId)) return i.editReply({ content: "❌ Role ID ต้องเป็นตัวเลข 17-20 หลัก" });
        getGuildConfig(i.guildId).adminRoleId = roleId;
        if (!(await saveConfig())) return i.editReply({ content: MSG_SAVE_FAIL });
        return i.editReply({ content: `✅ ตั้ง Access Role = <@&${roleId}>` });
    },

    async redeem_modal(i) {
        // เช็ค license ตรงนี้แทน (เดิมเช็คก่อน showModal ซึ่งช้าจนเกิน 3 วิ)
        const lic = await checkGuildLicenseCached(i.guildId);
        if (!lic.ok) return i.editReply({ content: lic.unreachable ? MSG_DOWN : "❌ Server นี้ไม่มี License หรือ License หมดอายุแล้ว" });
        const keyName = i.fields.getTextInputValue("key_input").trim();
        const r = await serverPost(`/keys/${kp(keyName)}/redeem`, { userId: i.user.id, guildId: i.guildId });
        if (isDown(r)) return i.editReply({ content: MSG_DOWN });
        if (!r.ok) {
            const msgs = {
                "Key ไม่ถูกต้อง": "❌ คีย์ไม่ถูกต้อง", "Key หมดอายุแล้ว": "❌ คีย์หมดอายุแล้ว",
                "Key used by someone else": "❌ คีย์ถูกใช้โดยคนอื่น", "Already redeemed": "⚠️ คุณใช้คีย์นี้อยู่แล้ว",
                "Key used in another guild": "❌ คีย์นี้ถูกใช้ใน Server อื่นแล้ว"
            };
            return i.editReply({ content: msgs[r.reason] || "❌ เกิดข้อผิดพลาด" });
        }
        clearCachedKey(cacheId(i.user.id, i.guildId));
        return i.editReply({ content: `✅ Redeem สำเร็จ!\n**Duration:** ${r.duration === -1 ? "♾️ ถาวร" : `${Math.floor(r.duration / 86400)} วัน`}` });
    },
};

async function handleModal(i) {
    await i.deferReply({ flags: EPHEMERAL });
    if (!i.inGuild()) return i.editReply({ content: "❌ ใช้ในเซิร์ฟเวอร์เท่านั้น" });
    if (MODAL_ADMIN.has(i.customId) && !isAdmin(i)) return i.editReply({ content: MSG_NO_PERM });
    if (!configLoaded && i.customId !== "redeem_modal" && i.customId !== "search_key_modal") return i.editReply({ content: MSG_LOADING });
    const fn = modalHandlers[i.customId];
    if (!fn) return i.editReply({ content: "❌ ฟอร์มนี้ไม่ได้ใช้งานแล้ว" });
    return fn(i);
}

// ====================================================================
//  EVENTS
// ====================================================================
async function replyError(i, err) {
    // 10062 = interaction หมดอายุ (บอทตอบช้า/มีบอทรันซ้อน 2 ตัว), 40060 = ตอบไปแล้ว (รันซ้อน)
    if (err?.code === 10062 || err?.code === 40060) {
        return console.warn(`[interaction ${err.code}] ${i.customId ?? i.commandName} — เช็คว่าไม่ได้รันบอทซ้อนหลายตัว`);
    }
    console.error("[interactionCreate error]", err);
    const payload = { content: "❌ เกิดข้อผิดพลาด กรุณาลองใหม่" };
    try {
        if (i.deferred || i.replied) await i.editReply(payload);
        else await i.reply({ ...payload, flags: EPHEMERAL });
    } catch {}
}

client.on(Events.InteractionCreate, async (i) => {
    try {
        if (i.isChatInputCommand()) return await handleSlash(i);
        if (i.isButton())           return await handleButton(i);
        if (i.isModalSubmit())      return await handleModal(i);
    } catch (err) {
        await replyError(i, err);
    }
});

client.once(Events.ClientReady, async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    loadConfig(); // retry เองเบื้องหลัง ไม่บล็อกบอท
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log("✅ Slash commands registered");
    } catch (e) {
        console.error("[register commands]", e.message);
    }
    // ปลุก server ไม่ให้หลับ
    setInterval(() => { fetchT(`${SERVER_URL}/ping`, {}, 8000).catch(() => {}); }, 10 * 60 * 1000).unref();
});

client.on(Events.Error, (e) => console.error("[client error]", e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("SIGTERM", () => { client.destroy(); process.exit(0); }); // Railway redeploy: ตัดการเชื่อมต่อทันที ไม่ให้ 2 instance ตอบซ้อนกัน
process.on("SIGINT",  () => { client.destroy(); process.exit(0); });

// ====================================================================
//  HTTP SERVER สำหรับ Render (Web Service ฟรีต้องมีพอร์ตเปิด + มี traffic เข้าถี่กว่า 15 นาที)
// ====================================================================
const http_ = require("http");
const PORT = process.env.PORT || 10000;
http_.createServer((req, res) => {
    const ready = client.isReady();
    res.writeHead(ready ? 200 : 503, { "Content-Type": "text/plain" });
    res.end(ready ? "ok" : "starting");
}).listen(PORT, () => console.log(`🌐 HTTP server listening on :${PORT}`));

// ยิงหาตัวเองผ่าน URL สาธารณะทุก 10 นาที (Render ใส่ RENDER_EXTERNAL_URL ให้อัตโนมัติ)
if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(() => {
        fetchT(process.env.RENDER_EXTERNAL_URL, {}, 10000).catch(() => {});
    }, 10 * 60 * 1000).unref();
}

client.login(TOKEN).catch((e) => { console.error("❌ Login failed:", e.message); process.exit(1); });
