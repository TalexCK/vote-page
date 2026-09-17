import hashlib
import hmac
import json
import os
import re
import sqlite3
import time
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal

import jwt
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Option(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=1000)


class Question(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=2000)
    type: Literal['single', 'multiple']
    required: bool
    proposer: str = Field(pattern=r'^[A-Za-z0-9_]{1,16}$')
    options: list[Option] = Field(min_length=2, max_length=100)

    @model_validator(mode='after')
    def unique_options(self):
        if len({o.id for o in self.options}) != len(self.options):
            raise ValueError('Duplicate option IDs')
        return self


class PageBreak(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['pagebreak']


SectionItem = Annotated[Question | PageBreak, Field(discriminator='type')]


class Category(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['category']
    title: str = Field(min_length=1, max_length=200)
    questions: list[SectionItem] = Field(min_length=1, max_length=300)

    @model_validator(mode='after')
    def has_questions(self):
        if not any(isinstance(item, Question) for item in self.questions):
            raise ValueError('Category must contain at least one question')
        return self


PollItem = Annotated[Question | PageBreak | Category, Field(discriminator='type')]


class Poll(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    starts_at: datetime
    ends_at: datetime
    questions: list[PollItem] = Field(min_length=1, max_length=300)

    def flat_questions(self):
        return [q for item in self.questions
                for q in (item.questions if isinstance(item, Category) else [item])
                if isinstance(q, Question)]

    def pages(self):
        pages = []

        def append_section(items, title=None):
            ids = []
            for item in items:
                if isinstance(item, PageBreak):
                    if ids:
                        pages.append({'title': title, 'question_ids': ids})
                        ids = []
                else:
                    ids.append(item.id)
            if ids:
                pages.append({'title': title, 'question_ids': ids})

        section = []
        for item in self.questions:
            if isinstance(item, Category):
                append_section(section)
                section = []
                append_section(item.questions, item.title)
            else:
                section.append(item)
        append_section(section)
        return pages

    @model_validator(mode='after')
    def valid(self):
        if any(t.tzinfo is None for t in (self.starts_at, self.ends_at)):
            raise ValueError('Times must include timezone')
        if self.starts_at >= self.ends_at:
            raise ValueError('ends_at must be after starts_at')
        questions = self.flat_questions()
        if not 1 <= len(questions) <= 100:
            raise ValueError('Poll must contain between 1 and 100 questions')
        if len({q.id for q in questions}) != len(questions):
            raise ValueError('Duplicate question IDs')
        return self


class Login(BaseModel):
    minecraft_id: str = Field(pattern=r'^[A-Za-z0-9_]{1,16}$')
    secret: str = Field(min_length=1, max_length=4096)


class Ballot(BaseModel):
    model_config = ConfigDict(extra='forbid')
    poll_id: str
    answers: dict[str, list[str]]


class PublishPoll(BaseModel):
    model_config = ConfigDict(extra='forbid')
    config: Poll


def now():
    return datetime.now(timezone.utc)


def create_app():
    jwt_key = os.environ['JWT_SECRET']
    if len(jwt_key.encode()) < 32:
        raise ValueError('JWT_SECRET must be at least 32 bytes')
    secret_salt = os.environ['SECRET_SALT']
    if not secret_salt.strip():
        raise ValueError('SECRET_SALT must not be empty')
    admins = {i.strip().lower() for i in os.getenv('ADMIN_IDS', '').split(',') if i.strip()}
    if any(not re.fullmatch(r'[a-z0-9_]{1,16}', i) for i in admins):
        raise ValueError('ADMIN_IDS must contain Minecraft IDs')
    secure = os.getenv('COOKIE_SECURE', 'true').lower() == 'true'
    db_path = os.getenv('DATABASE_PATH', 'data/votes.sqlite3')
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def db():
        conn = sqlite3.connect(db_path, timeout=15)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    @asynccontextmanager
    async def lifespan(app):
        with db() as conn:
            conn.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS polls (id TEXT PRIMARY KEY, config TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS active_poll (
                    singleton INTEGER PRIMARY KEY CHECK (singleton = 1), poll_id TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS ballots (
                    poll_id TEXT NOT NULL, player_key TEXT NOT NULL, player_id TEXT NOT NULL,
                    answers TEXT NOT NULL, submitted_at TEXT NOT NULL,
                    PRIMARY KEY (poll_id, player_key));
                CREATE TABLE IF NOT EXISTS login_attempts (
                    bucket TEXT PRIMARY KEY, start REAL NOT NULL, attempts INTEGER NOT NULL);
            ''')
        yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware('http')
    async def security(request: Request, call_next):
        # All mutations require JSON: cross-origin HTML forms cannot send this content type.
        if request.method == 'POST':
            if request.headers.get('content-type', '').split(';')[0].lower() != 'application/json':
                return Response(status_code=415)
            if request.headers.get('sec-fetch-site') == 'cross-site':
                return Response(status_code=403)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        return response

    def user(request: Request):
        try:
            claims = jwt.decode(request.cookies.get('session', ''), jwt_key, algorithms=['HS256'],
                                issuer='mua-vote', audience='mua-vote',
                                options={'require': ['exp', 'iat', 'sub']})
            player = claims['sub']
            if not isinstance(player, str) or not re.fullmatch(r'[A-Za-z0-9_]{1,16}', player):
                raise ValueError()
            return {'minecraft_id': player, 'is_admin': player.lower() in admins}
        except (jwt.PyJWTError, ValueError):
            raise HTTPException(401, '请登录')

    def admin(identity=Depends(user)):
        if not identity['is_admin']:
            raise HTTPException(403, '仅管理员可访问')
        return identity

    def load_poll(conn):
        row = conn.execute('SELECT config FROM polls JOIN active_poll ON polls.id=active_poll.poll_id WHERE singleton=1').fetchone()
        return Poll.model_validate_json(row['config']) if row else None

    def status(poll, current=None):
        current = current or now()
        return 'pending' if current < poll.starts_at else 'ended' if current >= poll.ends_at else 'open'

    @app.get('/api/management/poll')
    def management_poll(identity=Depends(admin)):
        with db() as conn:
            poll = load_poll(conn)
        return poll.model_dump(mode='json') if poll else None

    @app.post('/api/management/poll')
    def publish_poll(body: PublishPoll, identity=Depends(admin)):
        poll = body.config
        try:
            with db() as conn:
                conn.execute('BEGIN IMMEDIATE')
                conn.execute('INSERT INTO polls VALUES (?, ?)', (poll.id, poll.model_dump_json()))
                conn.execute('INSERT INTO active_poll VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET poll_id=excluded.poll_id', (poll.id,))
        except sqlite3.IntegrityError:
            raise HTTPException(409, '投票 ID 已存在，请使用新的 ID')
        return {'ok': True}

    @app.post('/api/login')
    def login(body: Login, request: Request, response: Response):
        # Shared SQLite limiter also works across worker processes. Do not trust forwarded IP headers.
        bucket = hashlib.sha256((request.client.host if request.client else 'unknown').encode()).hexdigest()
        current = time.time()
        with db() as conn:
            conn.execute('BEGIN IMMEDIATE')
            conn.execute('DELETE FROM login_attempts WHERE start < ?', (current - 300,))
            row = conn.execute('SELECT attempts FROM login_attempts WHERE bucket=?', (bucket,)).fetchone()
            if row and row['attempts'] >= 20:
                raise HTTPException(429, '请稍后再试')
            conn.execute('INSERT INTO login_attempts VALUES (?, ?, 1) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1', (bucket, current))
        expected = hashlib.sha256((body.minecraft_id + secret_salt).encode('utf-8')).hexdigest()[:32]
        if not hmac.compare_digest(body.secret.strip().encode('utf-8'), expected.encode('ascii')):
            raise HTTPException(401, 'ID 或 Secret 错误')
        token = jwt.encode({'sub': body.minecraft_id, 'iat': int(current), 'exp': int(current) + 43200,
                            'iss': 'mua-vote', 'aud': 'mua-vote'}, jwt_key, algorithm='HS256')
        response.set_cookie('session', token, httponly=True, secure=secure, samesite='strict', max_age=43200, path='/')
        return {'minecraft_id': body.minecraft_id, 'is_admin': body.minecraft_id.lower() in admins}

    @app.post('/api/logout')
    def logout(response: Response):
        response.delete_cookie('session', path='/', secure=secure, httponly=True, samesite='strict')
        return {'ok': True}

    @app.get('/api/me')
    def me(identity=Depends(user)):
        return identity

    @app.get('/api/poll')
    def get_poll(identity=Depends(user)):
        with db() as conn:
            conn.execute('BEGIN')
            poll = load_poll(conn)
            if poll is None:
                return None
            ballot = conn.execute('SELECT answers, submitted_at FROM ballots WHERE poll_id=? AND player_key=?',
                                  (poll.id, identity['minecraft_id'].lower())).fetchone()
        current = now()
        phase = status(poll, current)
        editable_at = datetime.fromisoformat(ballot['submitted_at']) + timedelta(minutes=10) if ballot else None
        return {**poll.model_dump(mode='json'),
                'questions': [q.model_dump(mode='json') for q in poll.flat_questions()],
                'pages': poll.pages(), 'status': phase, 'submitted': ballot is not None,
                'answers': json.loads(ballot['answers']) if ballot else {},
                'submitted_at': ballot['submitted_at'] if ballot else None,
                'editable_at': editable_at.isoformat() if editable_at else None,
                'can_edit': editable_at is not None and current >= editable_at and phase == 'open',
                'server_time': current.isoformat()}

    @app.post('/api/vote')
    def vote(body: Ballot, identity=Depends(user)):
        with db() as conn:
            conn.execute('BEGIN IMMEDIATE')
            poll = load_poll(conn)
            if poll is None or poll.id != body.poll_id:
                raise HTTPException(409, '投票已更新，请刷新页面')
            current = now()
            phase = status(poll, current)
            if phase != 'open':
                raise HTTPException(403, '投票未开始' if phase == 'pending' else '投票已结束')
            player_key = identity['minecraft_id'].lower()
            previous = conn.execute('SELECT submitted_at FROM ballots WHERE poll_id=? AND player_key=?',
                                    (poll.id, player_key)).fetchone()
            if previous and current < datetime.fromisoformat(previous['submitted_at']) + timedelta(minutes=10):
                raise HTTPException(409, '每次提交后需等待 10 分钟才能修改')
            questions = poll.flat_questions()
            if body.answers.keys() - {q.id for q in questions}:
                raise HTTPException(422, '题目无效')
            answers = {}
            for question in questions:
                chosen = body.answers.get(question.id, [])
                if (question.required and not chosen) or (question.type == 'single' and len(chosen) > 1):
                    raise HTTPException(422, '请完成必填题并检查选择数量')
                if len(set(chosen)) != len(chosen) or set(chosen) - {o.id for o in question.options}:
                    raise HTTPException(422, '选项无效')
                answers[question.id] = chosen
            conn.execute('''INSERT INTO ballots VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(poll_id, player_key) DO UPDATE SET
                            answers=excluded.answers, submitted_at=excluded.submitted_at''', (
                poll.id, player_key, identity['minecraft_id'], json.dumps(answers), current.isoformat()))
        return {'ok': True, 'submitted_at': current.isoformat(),
                'editable_at': (current + timedelta(minutes=10)).isoformat()}

    @app.get('/api/results')
    def results(identity=Depends(user)):
        with db() as conn:
            conn.execute('BEGIN')
            poll = load_poll(conn)
            if poll is None:
                raise HTTPException(404, '暂无投票')
            if not identity['is_admin'] and status(poll) != 'ended':
                raise HTTPException(403, '无权查看结果')
            rows = conn.execute('SELECT player_id, answers FROM ballots WHERE poll_id=? ORDER BY player_key', (poll.id,)).fetchall()
        ballots = [(row['player_id'], json.loads(row['answers'])) for row in rows]
        questions = []
        for q in poll.flat_questions():
            options = []
            for o in q.options:
                voters = [player for player, answers in ballots if o.id in answers.get(q.id, [])]
                options.append({**o.model_dump(), 'count': len(voters), 'voters': voters})
            questions.append({**q.model_dump(), 'total_votes': sum(bool(a.get(q.id)) for _, a in ballots), 'options': options})
        return {'id': poll.id, 'title': poll.title, 'questions': questions, 'pages': poll.pages()}

    static = Path(os.getenv('STATIC_DIR', 'frontend/dist')).resolve()

    @app.get('/{path:path}')
    def frontend(path: str):
        if path == 'api' or path.startswith('api/'):
            raise HTTPException(404)
        target = (static / path).resolve()
        if target.is_relative_to(static) and target.is_file():
            return FileResponse(target)
        if path not in ('', 'management') or not (static / 'index.html').exists():
            raise HTTPException(404)
        return FileResponse(static / 'index.html')

    return app
