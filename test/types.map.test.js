'use strict';

/**
 * Module dependencies.
 */

const assert = require('assert');
const co = require('co');
const start = require('./common');

const mongoose = start.mongoose;

/**
 * Test.
 */

describe('Map', function() {
  let db;

  before(function() {
    db = start();
  });

  after(function(done) {
    db.close(done);
  });

  it('validation', function() {
    let nestedValidateCalls = [];
    let validateCalls = [];
    const TestSchema = new mongoose.Schema({
      v: {
        type: Map,
        of: {
          type: Number,
          validate: function(v) {
            nestedValidateCalls.push(v);
            return v < 4;
          }
        },
        validate: function(v) {
          validateCalls.push(v);
          return true;
        }
      }
    });

    const Test = db.model('MapTest', TestSchema);

    return co(function*() {
      const doc = yield Test.create({ v: { x: 1 } });
      assert.deepEqual(nestedValidateCalls, [1]);
      assert.equal(validateCalls.length, 1);
      assert.equal(validateCalls[0].get('x'), 1);

      assert.ok(doc.v instanceof Map);

      let threw = false;

      try {
        yield Test.create({ v: { notA: 'number' } });
      } catch (error) {
        threw = true;
        assert.ok(!error.errors['v']);
        assert.ok(error.errors['v.notA']);
      }
      assert.ok(threw);

      doc.v.set('y', 5);

      threw = false;
      try {
        yield doc.save();
      } catch (error) {
        threw = true;
        assert.ok(!error.errors['v']);
        assert.ok(error.errors['v.y']);
      }
      assert.ok(threw);
    });
  });

  it('query casting', function() {
    const TestSchema = new mongoose.Schema({
      v: {
        type: Map,
        of: Number
      }
    });

    const Test = db.model('MapQueryTest', TestSchema);

    return co(function*() {
      const docs = yield Test.create([
        { v: { n: 1 } },
        { v: { n: 2 } }
      ]);

      let res = yield Test.find({ 'v.n': 1 });
      assert.equal(res.length, 1);

      res = yield Test.find({ v: { n: 2 } });
      assert.equal(res.length, 1);

      yield Test.updateOne({ _id: docs[1]._id }, { 'v.n': 3 });

      res = yield Test.find({ v: { n: 3 } });
      assert.equal(res.length, 1);

      let threw = false;
      try {
        yield Test.updateOne({ _id: docs[1]._id }, { 'v.n': 'not a number' });
      } catch (error) {
        threw = true;
        assert.equal(error.name, 'CastError');
      }
      assert.ok(threw);
      res = yield Test.find({ v: { n: 3 } });
      assert.equal(res.length, 1);
    });
  });

  it('defaults', function() {
    const TestSchema = new mongoose.Schema({
      n: Number,
      m: {
        type: Map,
        of: Number,
        default: { bacon: 2, eggs: 6 }
      }
    });

    const Test = db.model('MapDefaultsTest', TestSchema);

    return co(function*() {
      const doc = new Test({});
      assert.ok(doc.m instanceof Map);
      assert.deepEqual(Array.from(doc.toObject().m.keys()), ['bacon', 'eggs']);

      yield Test.updateOne({}, { n: 1 }, { upsert: true, setDefaultsOnInsert: true });

      const saved = yield Test.findOne({ n: 1 });
      assert.ok(saved);
      assert.deepEqual(Array.from(saved.toObject().m.keys()),
        ['bacon', 'eggs']);
    });
  });

  it('with single nested subdocs', function() {
    const TestSchema = new mongoose.Schema({
      m: {
        type: Map,
        of: new mongoose.Schema({ n: Number }, { _id: false, id: false })
      }
    });

    const Test = db.model('MapEmbeddedTest', TestSchema);

    return co(function*() {
      let doc = new Test({ m: { bacon: { n: 2 } } });

      yield doc.save();

      assert.ok(doc.m instanceof Map);
      assert.deepEqual(doc.toObject().m.get('bacon').toObject(), { n: 2 });

      doc.m.get('bacon').n = 4;
      yield doc.save();
      assert.deepEqual(doc.toObject().m.get('bacon').toObject(), { n: 4 });

      doc = yield Test.findById(doc._id);

      assert.deepEqual(doc.toObject().m.get('bacon').toObject(), { n: 4 });
    });
  });

  it('discriminators', function() {
    const TestSchema = new mongoose.Schema({
      n: Number
    });

    const Test = db.model('MapDiscrimTest', TestSchema);

    const Disc = Test.discriminator('MapDiscrimTest_0', new mongoose.Schema({
      m: {
        type: Map,
        of: Number
      }
    }));

    return co(function*() {
      const doc = new Disc({ m: { test: 1 } });
      assert.ok(doc.m instanceof Map);
      assert.deepEqual(Array.from(doc.toObject().m.keys()), ['test']);
      yield doc.save();

      const fromDb = yield Disc.findOne({ 'm.test': 1 });
      assert.ok(fromDb);
      assert.equal(fromDb._id.toHexString(), doc._id.toHexString());
    });
  });

  it('embedded discriminators', function() {
    const EmployeeSchema = new mongoose.Schema({
      name: String
    }, { _id: false, id: false });

    const DepartmentSchema = new mongoose.Schema({
      employees: [EmployeeSchema]
    });

    DepartmentSchema.path('employees').discriminator('Sales', new mongoose.Schema({
      clients: [String]
    }, { _id: false, id: false }));

    DepartmentSchema.path('employees').discriminator('Engineering', new mongoose.Schema({
      apiKeys: {
        type: Map,
        of: String
      }
    }, { _id: false, id: false }));

    const Department = db.model('MapEmbeddedDiscrimTest', DepartmentSchema);

    return co(function*() {
      const dept = new Department({
        employees: [
          { __t: 'Sales', name: 'E1', clients: ['test1', 'test2'] },
          { __t: 'Engineering', name: 'E2', apiKeys: { github: 'test3' } }
        ]
      });

      assert.deepEqual(dept.toObject().employees[0],
        { __t: 'Sales', name: 'E1', clients: ['test1', 'test2'] });

      assert.deepEqual(Array.from(dept.toObject().employees[1].apiKeys.values()),
        ['test3']);

      yield dept.save();

      let fromDb = yield Department.findOne({ 'employees.apiKeys.github': 'test3' });
      assert.ok(fromDb);

      dept.employees[1].apiKeys.set('github', 'test4');
      yield dept.save();

      fromDb = yield Department.findOne({ 'employees.apiKeys.github': 'test4' });
      assert.ok(fromDb);
    });
  });
});