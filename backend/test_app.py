import hashlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

import app as module


SALT = 'SHTechCraft Secret Service 357c0ddc72885367e8fd38db56bc25538d4d1056fcbbb45a65c8fe6647ee1e46'


@pytest.fixture
def setup(tmp_path, monkeypatch):
    current = datetime.now(timezone.utc)
    poll = {'id': 'test', 'title': '投票', 'starts_at': (current - timedelta(hours=1)).isoformat(),
            'ends_at': (current + timedelta(hours=1)).isoformat(), 'questions': [
                {'id': 'q1', 'title': '单选', 'type': 'single', 'required': True, 'proposer': 'Admin',
                 'options': [{'id': 'a', 'label': 'A'}, {'id': 'b', 'label': 'B'}]},
                {'id': 'q2', 'title': '多选', 'type': 'multiple', 'required': False, 'proposer': 'Player',
                 'options': [{'id': 'c', 'label': 'C'}, {'id': 'd', 'label': 'D'}]}]}
    monkeypatch.setenv('JWT_SECRET', 'test-only-key-' * 4)
    monkeypatch.setenv('SECRET_SALT', SALT)
    monkeypatch.setenv('ADMIN_IDS', 'Admin')
    monkeypatch.setenv('COOKIE_SECURE', 'false')
    monkeypatch.setenv('DATABASE_PATH', str(tmp_path / 'votes.db'))

    def secret(player):
        return hashlib.sha256((player + SALT).encode('utf-8')).hexdigest()[:32]

    with TestClient(module.create_app()) as client:
        yield client, secret, current, poll


def login(client, secret, player='Player'):
    return client.post('/api/login', json={'minecraft_id': player, 'secret': secret(player)})


def publish(client, secret, poll):
    login(client, secret, 'Admin')
    assert client.post('/api/management/poll', json={'config': poll}).status_code == 200
    login(client, secret)


def vote(client, answers, poll_id='test'):
    return client.post('/api/vote', json={'poll_id': poll_id, 'answers': answers})


def test_secret_algorithm_and_environment(setup, monkeypatch):
    client, _, _, _ = setup
    known = '6034cfa43ea20f853e59bcf3894e2ea0'
    assert client.post('/api/login', json={'minecraft_id': 'Player', 'secret': known}).status_code == 200
    for wrong in (known.upper(), 'shtc-' + known, '密钥', '0' * 32):
        assert client.post('/api/login', json={'minecraft_id': 'Player', 'secret': wrong}).status_code == 401
    assert client.post('/api/login', json={'minecraft_id': 'player', 'secret': known}).status_code == 401
    monkeypatch.setenv('SECRET_SALT', 'different-salt')
    with TestClient(module.create_app()) as changed:
        assert changed.post('/api/login', json={'minecraft_id': 'Player', 'secret': known}).status_code == 401
        expected = hashlib.sha256(b'Playerdifferent-salt').hexdigest()[:32]
        assert changed.post('/api/login', json={'minecraft_id': 'Player', 'secret': expected}).status_code == 200
    monkeypatch.setenv('SECRET_SALT', ' ')
    with pytest.raises(ValueError, match='SECRET_SALT'):
        module.create_app()
    monkeypatch.delenv('SECRET_SALT')
    with pytest.raises(KeyError, match='SECRET_SALT'):
        module.create_app()


def test_auth_and_access(setup):
    client, secret, _, poll = setup
    assert client.get('/api/poll').status_code == 401
    assert client.get('/api/results').status_code == 401
    assert client.post('/api/management/poll', json={'config': poll}).status_code == 401
    assert client.post('/api/login', json={'minecraft_id': 'Admin', 'secret': secret('Player')}).status_code == 401
    response = login(client, secret)
    assert response.status_code == 200
    assert 'HttpOnly' in response.headers['set-cookie']
    assert 'SameSite=strict' in response.headers['set-cookie']
    assert client.get('/api/me').json() == {'minecraft_id': 'Player', 'is_admin': False}
    assert client.get('/api/poll').json() is None
    assert client.get('/api/management/poll').status_code == 403
    assert client.post('/api/management/poll', json={'config': poll}).status_code == 403
    publish(client, secret, poll)
    assert client.get('/api/results').status_code == 403
    client.cookies.set('session', jwt.encode({'sub': 'Admin', 'exp': 1}, 'x' * 32, algorithm='HS256'))
    assert client.get('/api/me').status_code == 401
    client.cookies.clear()
    login(client, secret, 'Admin')
    assert client.get('/api/results').status_code == 200
    assert client.post('/api/logout', json={}).status_code == 200
    assert client.get('/api/me').status_code == 401


def test_validation_submission_and_results(setup, monkeypatch):
    client, secret, current, poll = setup
    publish(client, secret, poll)
    for answers in ({}, {'q1': ['a', 'b']}, {'q1': ['bad']}, {'q1': ['a'], 'q2': ['c', 'c']}, {'q1': ['a'], 'unknown': []}):
        assert vote(client, answers).status_code == 422
    assert client.get('/api/poll').json()['submitted'] is False
    assert 'voters' not in client.get('/api/poll').text
    assert vote(client, {'q1': ['a'], 'q2': ['c', 'd']}).status_code == 200
    assert client.get('/api/poll').json()['submitted'] is True
    login(client, secret, 'player')
    assert vote(client, {'q1': ['b']}).status_code == 409
    login(client, secret, 'Admin')
    assert vote(client, {'q1': ['b']}).status_code == 200
    results = client.get('/api/results').json()['questions']
    assert results[0]['total_votes'] == 2
    assert results[0]['options'][0]['voters'] == ['Player']
    assert results[1]['total_votes'] == 1
    assert [o['count'] for o in results[1]['options']] == [1, 1]
    login(client, secret)
    monkeypatch.setattr(module, 'now', lambda: current + timedelta(hours=1))
    assert client.get('/api/poll').json()['status'] == 'ended'
    assert client.get('/api/results').status_code == 200
    assert vote(client, {'q1': ['a']}).status_code == 403


def test_schedule_and_atomic_submission(setup, monkeypatch):
    client, secret, current, poll = setup
    publish(client, secret, poll)
    monkeypatch.setattr(module, 'now', lambda: current - timedelta(hours=2))
    assert client.get('/api/poll').json()['status'] == 'pending'
    assert vote(client, {'q1': ['a']}).status_code == 403
    monkeypatch.setattr(module, 'now', lambda: current)
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: vote(client, {'q1': ['a']}).status_code, range(2)))
    assert sorted(statuses) == [200, 409]
    with TestClient(module.create_app()) as other:
        login(other, secret)
        assert other.get('/api/poll').json()['submitted'] is True


def test_edit_cooldown_replaces_answers_and_preserves_privacy(setup, monkeypatch):
    client, secret, current, poll = setup
    publish(client, secret, poll)
    monkeypatch.setattr(module, 'now', lambda: current)
    initial = client.get('/api/poll').json()
    assert initial['answers'] == {} and initial['editable_at'] is None
    assert initial['can_edit'] is False
    response = vote(client, {'q1': ['a'], 'q2': ['c']}).json()
    assert response['editable_at'] == (current + timedelta(minutes=10)).isoformat()
    saved = client.get('/api/poll').json()
    assert saved['answers'] == {'q1': ['a'], 'q2': ['c']}
    assert saved['can_edit'] is False
    monkeypatch.setattr(module, 'now', lambda: current + timedelta(minutes=10, microseconds=-1))
    assert vote(client, {'q1': ['b']}).status_code == 409
    monkeypatch.setattr(module, 'now', lambda: current + timedelta(minutes=10))
    assert client.get('/api/poll').json()['can_edit'] is True
    # A failed edit must not reset the cooldown or erase previous answers.
    assert vote(client, {}).status_code == 422
    assert client.get('/api/poll').json()['answers'] == saved['answers']
    assert client.get('/api/poll').json()['can_edit'] is True
    assert vote(client, {'q1': ['b']}).status_code == 200
    assert client.get('/api/poll').json()['answers'] == {'q1': ['b'], 'q2': []}
    assert client.get('/api/poll').json()['can_edit'] is False
    assert vote(client, {'q1': ['a']}).status_code == 409
    login(client, secret, 'Admin')
    assert client.get('/api/poll').json()['answers'] == {}
    results = client.get('/api/results').json()['questions']
    assert results[0]['total_votes'] == 1
    assert results[0]['options'][0]['voters'] == []
    assert results[0]['options'][1]['voters'] == ['Player']
    assert results[1]['total_votes'] == 0
    login(client, secret)
    monkeypatch.setattr(module, 'now', lambda: current + timedelta(minutes=20))
    assert client.get('/api/poll').json()['can_edit'] is True
    assert vote(client, {'q1': ['a']}).status_code == 200
    monkeypatch.setattr(module, 'now', lambda: current + timedelta(hours=1))
    assert client.get('/api/poll').json()['can_edit'] is False
    assert vote(client, {'q1': ['b']}).status_code == 403


def test_concurrent_edits_and_restart_keep_cooldown(setup, monkeypatch):
    client, secret, current, poll = setup
    publish(client, secret, poll)
    monkeypatch.setattr(module, 'now', lambda: current)
    assert vote(client, {'q1': ['a']}).status_code == 200
    monkeypatch.setattr(module, 'now', lambda: current + timedelta(minutes=10))
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: vote(client, {'q1': ['b']}).status_code, range(2)))
    assert sorted(statuses) == [200, 409]
    with TestClient(module.create_app()) as other:
        login(other, secret, 'player')
        assert other.get('/api/poll').json()['answers'] == {'q1': ['b'], 'q2': []}
        assert other.get('/api/poll').json()['can_edit'] is False
        assert vote(other, {'q1': ['a']}).status_code == 409


def test_login_rate_limit_and_csrf(setup):
    client, _, _, _ = setup
    assert client.post('/api/login', data={'minecraft_id': 'Player', 'secret': 'bad'}).status_code == 415
    assert client.post('/api/logout', json={}, headers={'sec-fetch-site': 'cross-site'}).status_code == 403
    for _ in range(20):
        assert client.post('/api/login', json={'minecraft_id': 'Player', 'secret': 'bad'}).status_code == 401
    assert client.post('/api/login', json={'minecraft_id': 'Player', 'secret': 'bad'}).status_code == 429


def test_publish_validation_and_stale_ballot(setup):
    client, secret, _, poll = setup
    login(client, secret, 'Admin')
    assert client.get('/api/management/poll').json() is None
    invalid = {**poll, 'ends_at': poll['starts_at']}
    assert client.post('/api/management/poll', json={'config': invalid}).status_code == 422
    assert client.get('/api/poll').json() is None
    publish(client, secret, poll)
    assert vote(client, {'q1': ['a']}).status_code == 200
    login(client, secret, 'Admin')
    assert client.get('/api/management/poll').json()['id'] == 'test'
    assert client.post('/api/management/poll', json={'config': poll}).status_code == 409
    new_poll = {**poll, 'id': 'next'}
    assert client.post('/api/management/poll', json={'config': new_poll}).status_code == 200
    login(client, secret)
    assert vote(client, {'q1': ['a']}).status_code == 409
    assert client.get('/api/poll').json()['submitted'] is False
    assert vote(client, {'q1': ['b']}, poll_id='next').status_code == 200
    login(client, secret, 'Admin')
    assert client.get('/api/results').json()['questions'][0]['options'][0]['count'] == 0
