require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
if (!process.env.MONGODB_URI || !process.env.SESSION_SECRET) {
  console.error('Missing MONGODB_URI or SESSION_SECRET environment variable.'); process.exit(1);
}
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '300kb' }));

// Permit the Remix Nexus frontend to use this account API from its own origin.
// Keep this allow-list exact: credentialed CORS must never use '*'.
const allowedFrontendOrigins = new Set([
  'https://remix-nexus-tygt.onrender.com'
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedFrontendOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    if (!origin || !allowedFrontendOrigins.has(origin)) return res.sendStatus(403);
    return res.status(204).end();
  }
  next();
});

app.use(rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:'draft-7',legacyHeaders:false}));
const userSchema = new mongoose.Schema({
  email: {type:String, required:true, unique:true, lowercase:true, trim:true, maxlength:254},
  displayName: {type:String, default:'', maxlength:30},
  passwordHash: {type:String, required:true},
  createdAt: {type:Date, default:Date.now}
}, {versionKey:false});
const User = mongoose.model('LifeLoopUser', userSchema);
const saveSchema = new mongoose.Schema({
  userId: {type:mongoose.Schema.Types.ObjectId, required:true, unique:true, index:true},
  game: {type:mongoose.Schema.Types.Mixed, default:null},
  ended: {type:mongoose.Schema.Types.Mixed, default:null},
  legacy: {type:mongoose.Schema.Types.Mixed, default:()=>({lives:[],achievements:{}})},
  settings: {type:mongoose.Schema.Types.Mixed, default:()=>({})},
  updatedAt: {type:Date, default:Date.now}
}, {versionKey:false});
const Save = mongoose.model('LifeLoopSave', saveSchema);
app.use(session({name:'lifeloop.sid', secret:process.env.SESSION_SECRET, resave:false, saveUninitialized:false, store:MongoStore.create({mongoUrl:process.env.MONGODB_URI, collectionName:'lifeloop_sessions', ttl:7*24*60*60}), cookie:{httpOnly:true, secure:isProd, sameSite:isProd?'none':'lax', maxAge:7*24*60*60*1000}}));
const authLimiter=rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many login attempts. Please wait 15 minutes and try again.'}});
function cleanUser(u){return {id:String(u._id),email:u.email,displayName:u.displayName||''};}
function requireAuth(req,res,next){if(!req.session.userId)return res.status(401).json({error:'Please log in to access your private LifeLoop data.'});next();}
app.get('/api/health',(req,res)=>res.json({ok:true,service:'LifeLoop accounts'}));
app.post('/api/auth/register',authLimiter,async(req,res)=>{
  try{
    const email=String(req.body.email||'').trim().toLowerCase();const password=String(req.body.password||'');const displayName=String(req.body.displayName||'').trim().slice(0,30);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return res.status(400).json({error:'Enter a valid email address.'});
    if(password.length<10||password.length>128)return res.status(400).json({error:'Password must be between 10 and 128 characters.'});
    const existing=await User.findOne({email}).lean();if(existing)return res.status(409).json({error:'An account with that email already exists. Please log in.'});
    const passwordHash=await bcrypt.hash(password,12);const u=await User.create({email,displayName,passwordHash});
    req.session.userId=String(u._id);await new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));
    await Save.updateOne({userId:u._id},{$setOnInsert:{userId:u._id,game:null,ended:null,legacy:{lives:[],achievements:{}},settings:{},updatedAt:new Date()}},{upsert:true});
    res.status(201).json({user:cleanUser(u)});
  }catch(e){if(e.code===11000)return res.status(409).json({error:'An account with that email already exists.'});console.error('register failed',e.message);res.status(500).json({error:'Could not create the account right now.'});}
});
app.post('/api/auth/login',authLimiter,async(req,res)=>{
  try{const email=String(req.body.email||'').trim().toLowerCase();const password=String(req.body.password||'');const u=await User.findOne({email});if(!u||!(await bcrypt.compare(password,u.passwordHash)))return res.status(401).json({error:'Email or password is incorrect.'});
    await new Promise((resolve,reject)=>req.session.regenerate(err=>err?reject(err):resolve()));req.session.userId=String(u._id);await new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));res.json({user:cleanUser(u)});
  }catch(e){console.error('login failed',e.message);res.status(500).json({error:'Could not log in right now.'});}
});
app.get('/api/auth/me',requireAuth,async(req,res)=>{try{const u=await User.findById(req.session.userId).lean();if(!u){req.session.destroy(()=>{});return res.status(401).json({error:'Account not found. Please log in again.'});}res.json({user:cleanUser(u)});}catch(e){res.status(500).json({error:'Could not verify your session.'});}});
app.post('/api/auth/logout',requireAuth,(req,res)=>req.session.destroy(err=>{if(err)return res.status(500).json({error:'Could not log out. Please try again.'});res.clearCookie('lifeloop.sid',{httpOnly:true,secure:isProd,sameSite:isProd?'none':'lax'});res.json({ok:true});}));
app.get('/api/lifeloop/save',requireAuth,async(req,res)=>{try{const u=await User.findById(req.session.userId).lean();if(!u)return res.status(401).json({error:'Please log in again.'});let save=await Save.findOne({userId:u._id}).lean();if(!save)save=await Save.create({userId:u._id});res.json({user:cleanUser(u),save:{game:save.game||null,ended:save.ended||null,legacy:save.legacy||{lives:[],achievements:{}},settings:save.settings||{},updatedAt:save.updatedAt}});}catch(e){console.error('load save failed',e.message);res.status(500).json({error:'Could not load cloud progress.'});}});
app.put('/api/lifeloop/save',requireAuth,async(req,res)=>{try{
  const b=req.body||{};const safe={game:b.game&&typeof b.game==='object'?b.game:null,ended:b.ended&&typeof b.ended==='object'?b.ended:null,legacy:b.legacy&&typeof b.legacy==='object'?b.legacy:{lives:[],achievements:{}},settings:b.settings&&typeof b.settings==='object'?b.settings:{},updatedAt:new Date()};
  if(safe.legacy.lives&&!Array.isArray(safe.legacy.lives))return res.status(400).json({error:'Invalid legacy data.'});
  if(Array.isArray(safe.legacy.lives))safe.legacy.lives=safe.legacy.lives.slice(0,100);
  await Save.findOneAndUpdate({userId:req.session.userId},{$set:safe,$setOnInsert:{userId:req.session.userId}},{upsert:true,new:true,runValidators:true});res.json({ok:true,savedAt:safe.updatedAt});
 }catch(e){console.error('save failed',e.message);res.status(500).json({error:'Cloud save failed. Your local copy is still available; please retry.'});}});
// This service folder contains the frontend files directly (no public/ subfolder).
app.use((req, res, next) => {
  if (/\/(?:server\.js|package\.json|render\.yaml|\.env(?:\..*)?)$/i.test(req.path)) return res.sendStatus(404);
  next();
});
app.use(express.static(__dirname, { dotfiles: 'deny' }));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:15000}).then(()=>{app.listen(PORT,'0.0.0.0',()=>console.log(`LifeLoop service listening on ${PORT}`));}).catch(e=>{console.error('MongoDB connection failed:',e.message);process.exit(1);});
