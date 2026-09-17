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


def test_pagebreak_categories_and_grouped_ballots(setup):
    client, secret, _, poll = setup
    question = poll['questions'][0]
    q = lambda number: {**question, 'id': f'q{number}'}
    pagebreak = {'type': 'pagebreak'}
    poll['questions'] = [
        pagebreak, q(1), pagebreak, pagebreak, q(2),
        {'type': 'category', 'title': '分类 A', 'questions': [q(3), q(4), pagebreak, q(5)]},
        {'type': 'category', 'title': '分类 B', 'questions': [q(6)]}, q(7), pagebreak,
    ]
    publish(client, secret, poll)
    loaded = client.get('/api/poll').json()
    expected_pages = [
        {'title': None, 'question_ids': ['q1']},
        {'title': None, 'question_ids': ['q2']},
        {'title': '分类 A', 'question_ids': ['q3', 'q4']},
        {'title': '分类 A', 'question_ids': ['q5']},
        {'title': '分类 B', 'question_ids': ['q6']},
        {'title': None, 'question_ids': ['q7']},
    ]
    assert loaded['pages'] == expected_pages
    assert [item['id'] for item in loaded['questions']] == [f'q{i}' for i in range(1, 8)]
    answers = {f'q{i}': ['a'] for i in range(1, 8)}
    assert vote(client, {key: value for key, value in answers.items() if key != 'q4'}).status_code == 422
    assert vote(client, {**answers, 'category': ['a']}).status_code == 422
    assert vote(client, answers).status_code == 200
    assert client.get('/api/results').status_code == 403
    login(client, secret, 'Admin')
    assert client.get('/api/management/poll').json()['questions'] == poll['questions']
    results = client.get('/api/results').json()
    assert results['pages'] == expected_pages
    assert all(question['total_votes'] == 1 for question in results['questions'])
    assert all(question['options'][0]['voters'] == ['Player'] for question in results['questions'])


def test_category_configuration_validation_and_legacy_layout(setup):
    client, secret, _, poll = setup
    login(client, secret, 'Admin')
    question = poll['questions'][0]
    for items in (
        [{'type': 'pagebreak'}],
        [{'type': 'category', 'title': '空分类', 'questions': [{'type': 'pagebreak'}]}],
        [question, {'type': 'category', 'title': '重复 ID', 'questions': [question]}],
        [{'type': 'category', 'title': '', 'questions': [question]}],
    ):
        assert client.post('/api/management/poll', json={'config': {**poll, 'questions': items}}).status_code == 422
    assert client.post('/api/management/poll', json={'config': poll}).status_code == 200
    assert client.get('/api/poll').json()['pages'] == [{'title': None, 'question_ids': ['q1', 'q2']}]


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


def test_conditional_pagebreaks_and_any_label(setup):
    client, secret, _, poll = setup
    q1, q2 = poll['questions']
    q1['type'] = 'multiple'
    gate = {'question_id': 'q1', 'option_labels': ['B']}
    pagebreak = {'type': 'pagebreak', 'condition': gate}
    poll['questions'] = [q1, pagebreak, pagebreak, q2, pagebreak]
    publish(client, secret, poll)
    assert client.get('/api/poll').json()['pages'] == [
        {'title': None, 'question_ids': ['q1'], 'exit_gates': [gate, gate]},
        {'title': None, 'question_ids': ['q2'], 'exit_gates': [gate]},
    ]
    assert vote(client, {'q1': ['a']}).status_code == 422
    assert vote(client, {'q1': ['a', 'b']}).status_code == 200


def test_skipped_category_discards_required_and_stale_answers(setup):
    client, secret, _, poll = setup
    q1, q2 = poll['questions']
    q2['required'] = True
    condition = {'question_id': 'q1', 'option_labels': ['B']}
    gate = {'type': 'pagebreak', 'condition': {'question_id': 'q2', 'option_labels': ['C']}}
    q3 = {**q2, 'id': 'q3'}
    poll['questions'] = [q1, {'type': 'category', 'title': 'Hidden', 'condition': condition,
                                     'questions': [q2, gate, q3]},
                         {'type': 'category', 'title': 'Dependent',
                          'condition': gate['condition'], 'questions': [{**q2, 'id': 'q4'}]}]
    publish(client, secret, poll)
    pages = client.get('/api/poll').json()['pages']
    assert all(page['condition'] == condition for page in pages[1:3])
    assert vote(client, {'q1': ['b']}).status_code == 422
    assert vote(client, {'q1': ['a'], 'q2': ['c'], 'q3': ['invalid']}).status_code == 200
    assert client.get('/api/poll').json()['answers'] == {'q1': ['a']}


def test_external_and_leading_category_gates(setup):
    client, secret, _, poll = setup
    q1, q2 = poll['questions']
    condition = {'question_id': 'q1', 'option_labels': ['B']}
    gate = {'type': 'pagebreak', 'condition': condition}
    poll['questions'] = [q1, {'type': 'category', 'title': 'Conditional', 'condition': condition,
                                     'questions': [gate, gate, q2]}, gate, gate]
    publish(client, secret, poll)
    pages = client.get('/api/poll').json()['pages']
    assert pages[1]['gates'] == [condition, condition]
    assert pages[2] == {'title': None, 'question_ids': [], 'exit_gates': [condition, condition]}
    # External trailing gates still apply when the preceding category is hidden.
    assert vote(client, {'q1': ['a']}).status_code == 422
    assert vote(client, {'q1': ['b']}).status_code == 200


def test_invalid_condition_references_and_labels(setup):
    client, secret, _, poll = setup
    login(client, secret, 'Admin')
    q1, q2 = poll['questions']
    for condition in (
        {'question_id': 'missing', 'option_labels': ['A']},
        {'question_id': 'q2', 'option_labels': ['C']},
        {'question_id': 'q1', 'option_labels': ['missing']},
        {'question_id': 'q1', 'option_labels': []},
        {'question_id': 'q1', 'option_labels': ['A', 'A']},
    ):
        for section in (
            [q1, {'type': 'pagebreak', 'condition': condition}, q2],
            [q1, {'type': 'category', 'title': 'Category', 'condition': condition, 'questions': [q2]}],
        ):
            assert client.post('/api/management/poll', json={
                'config': {**poll, 'questions': section}}).status_code == 422
    duplicate = {**q1, 'options': [{'id': 'a', 'label': 'A'}, {'id': 'b', 'label': 'A'}]}
    assert client.post('/api/management/poll', json={
        'config': {**poll, 'questions': [duplicate]}}).status_code == 200


def test_absent_conditions_preserve_stored_config(setup):
    import json
    import sqlite3

    client, secret, _, poll = setup
    q1, q2 = poll['questions']
    poll['questions'] = [q1, {'type': 'pagebreak'},
                         {'type': 'category', 'title': 'Category', 'questions': [q2]}]
    publish(client, secret, poll)
    login(client, secret, 'Admin')
    assert client.get('/api/management/poll').json()['questions'] == poll['questions']
    with sqlite3.connect(module.os.environ['DATABASE_PATH']) as conn:
        stored = json.loads(conn.execute('SELECT config FROM polls').fetchone()[0])
    assert stored['questions'] == poll['questions']


def text_question(**changes):
    return {'id': 'text', 'title': 'Text', 'type': 'text', 'required': False,
            'proposer': 'Admin', **changes}


def test_text_validation_and_results(setup):
    client, secret, _, poll = setup
    login(client, secret, 'Admin')
    for question in (text_question(pattern='['), text_question(pattern='a{99999999999999999999}'),
                     text_question(pattern='x' * 501),
                     text_question(options=poll['questions'][0]['options']),
                     {**poll['questions'][0], 'options': []}):
        assert client.post('/api/management/polls', json={
            'config': {**poll, 'questions': [question]}}).status_code == 422
    poll['questions'] = [text_question(required=True, pattern=r'[A-Z]+'), text_question(id='empty')]
    publish(client, secret, poll)
    for values in ([], [''], ['  '], ['ABC', 'DEF'], ['ABC1'], ['x' * 2001]):
        assert vote(client, {'text': values}).status_code == 422
    assert vote(client, {'text': ['ABC'], 'empty': [' \t\n']}).status_code == 200
    assert client.get('/api/poll').json()['answers'] == {'text': ['ABC'], 'empty': []}
    login(client, secret, 'Admin')
    result = client.get('/api/results').json()['questions']
    assert result[0]['responses'] == [{'player_id': 'Player', 'text': 'ABC'}]
    assert result[0]['total_votes'] == 1
    assert result[1]['responses'] == []
    assert result[1]['total_votes'] == 0


def test_regex_execution_is_bounded(setup, monkeypatch):
    client, secret, _, poll = setup
    poll['questions'] = [text_question(pattern=r'(a|aa)+')]
    publish(client, secret, poll)
    import time
    start = time.monotonic()
    assert vote(client, {'text': ['a' * 1999 + '!']}).status_code == 422
    assert time.monotonic() - start < 2
    original = module.regex.fullmatch
    calls = []

    def timed(pattern, text, *, timeout):
        calls.append(timeout)
        raise TimeoutError()

    monkeypatch.setattr(module.regex, 'fullmatch', timed)
    assert vote(client, {'text': ['a']}).status_code == 422
    assert calls == [0.02]
    monkeypatch.setattr(module.regex, 'fullmatch', original)
    assert vote(client, {'text': ['aaa']}).status_code == 200


def test_hidden_chains_and_conditions(setup, monkeypatch):
    client, secret, current, poll = setup
    q1, q2 = poll['questions']
    q2.update(hidden=True, required=True, condition={'question_id': 'q1', 'option_labels': ['A']})
    poll['questions'] += [text_question(required=True, hidden=True,
                                       condition={'question_id': 'q2', 'option_labels': ['C']}),
                          text_question(id='never', required=True, hidden=True),
                          text_question(id='always', hidden=False,
                                        condition={'question_id': 'q1', 'option_labels': ['A']})]
    publish(client, secret, poll)
    assert vote(client, {'q1': ['a']}).status_code == 422
    assert vote(client, {'q1': ['a'], 'q2': ['c']}).status_code == 422
    assert vote(client, {'q1': ['a'], 'q2': ['c'], 'text': ['saved']}).status_code == 200
    monkeypatch.setattr(module, 'now', lambda: current + timedelta(minutes=11))
    assert vote(client, {'q1': ['b'], 'q2': ['c'], 'text': ['stale'], 'never': ['stale'],
                         'always': ['visible']}).status_code == 200
    assert client.get('/api/poll').json()['answers'] == {'q1': ['b'], 'always': ['visible']}
    login(client, secret, 'Admin')
    for condition in ({'question_id': 'q2', 'option_labels': ['C']},
                      {'question_id': 'q1', 'option_labels': ['unknown']}):
        invalid = {**q1, 'condition': condition}
        assert client.post('/api/management/polls', json={
            'config': {**poll, 'questions': [invalid, q2]}}).status_code == 422
    for item in ({**q1, 'condition': {'question_id': 'text', 'option_labels': ['X']}},
                 {'type': 'category', 'title': 'C', 'questions': [q1],
                  'condition': {'question_id': 'text', 'option_labels': ['X']}},
                 {'type': 'pagebreak', 'condition': {'question_id': 'text', 'option_labels': ['X']}}):
        assert client.post('/api/management/polls', json={
            'config': {**poll, 'questions': [text_question(), item]}}).status_code == 422


def test_multi_poll_activation_and_permissions(setup):
    client, secret, _, poll = setup
    endpoints = [('/api/management/polls', None),
                 ('/api/management/polls/test', None),
                 ('/api/management/polls/test/results', None),
                 ('/api/management/poll?poll_id=test', None),
                 ('/api/management/results?poll_id=test', None),
                 ('/api/management/polls', {'config': poll}),
                 ('/api/management/active-poll', {'poll_id': 'test'})]
    for expected in (401, 403):
        for path, body in endpoints:
            response = client.get(path) if body is None else client.post(path, json=body)
            assert response.status_code == expected
        login(client, secret)
    publish(client, secret, poll)
    assert vote(client, {'q1': ['a']}).status_code == 200
    login(client, secret, 'Admin')
    # Query-based archive access also supports IDs accepted by older versions.
    unusual = {**poll, 'id': 'season/1?draft#1'}
    assert client.post('/api/management/polls', json={'config': unusual}).status_code == 200
    assert client.get('/api/management/poll', params={'poll_id': unusual['id']}).json()['id'] == unusual['id']
    assert client.get('/api/management/results', params={'poll_id': unusual['id']}).json()['id'] == unusual['id']
    second = {**poll, 'id': 'second'}
    assert client.post('/api/management/polls', json={'config': second}).status_code == 200
    listing = client.get('/api/management/polls').json()
    assert listing['active_poll_id'] == 'test'
    assert [(p['id'], p['ballot_count'], p['question_count']) for p in listing['polls']] == [
        ('test', 1, 2), ('season/1?draft#1', 0, 2), ('second', 0, 2)]
    assert client.get('/api/management/polls/second').json()['questions'] == poll['questions']
    assert client.post('/api/management/polls', json={'config': second}).status_code == 409
    assert client.post('/api/management/active-poll', json={'poll_id': 'missing'}).status_code == 404
    assert client.get('/api/management/polls').json()['active_poll_id'] == 'test'
    for path, body in endpoints:
        if body is not None:
            assert client.post(path, json=body, headers={'sec-fetch-site': 'cross-site'}).status_code == 403
            assert client.post(path, content='{}').status_code == 415
    assert client.post('/api/management/active-poll', json={'poll_id': 'second'}).status_code == 200
    assert client.get('/api/results').json()['questions'][0]['total_votes'] == 0
    assert client.get('/api/management/polls/test/results').json()['questions'][0]['options'][0]['voters'] == ['Player']
    assert client.get('/api/management/polls/missing/results').status_code == 404
    assert client.get('/api/management/polls/missing').status_code == 404
    assert client.post('/api/management/active-poll', json={'poll_id': None}).status_code == 200
    assert client.get('/api/poll').json() is None
    assert client.get('/api/management/polls').json()['active_poll_id'] is None
    assert client.post('/api/management/active-poll', json={'poll_id': 'test'}).status_code == 200
    login(client, secret, 'player')
    assert client.get('/api/poll').json()['answers']['q1'] == ['a']
    assert vote(client, {'q1': ['b']}).status_code == 409
