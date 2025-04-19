const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;

class DatabaseSingleton {
    static instance = null;
    client = null;
    
    static getInstance() {
        if (!DatabaseSingleton.instance) {
            DatabaseSingleton.instance = new DatabaseSingleton();
            const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7nwjyzo.mongodb.net/?retryWrites=true&w=majority`;
            this.instance.client = new MongoClient(uri, {
                serverApi: {
                    version: ServerApiVersion.v1,
                    strict: true,
                    deprecationErrors: true,
                }
            });
        }
        return DatabaseSingleton.instance;
    }
}

class CollectionFactory {
    static createCollection(type, db) {
        switch(type) {
            case 'packages': return db.collection('packages');
            case 'guides': return db.collection('guides');
            case 'bookings': return db.collection('bookings');
            case 'reviews': return db.collection('reviews');
            case 'stories': return db.collection('stories');
            case 'wishLists': return db.collection('wishLists');
            case 'users': return db.collection('users');
            default: throw new Error('Unknown collection type');
        }
    }
}

class BaseRepository {
    async find() { throw new Error('Method not implemented'); }
    async findOne() { throw new Error('Method not implemented'); }
    async insertOne() { throw new Error('Method not implemented'); }
    async updateOne() { throw new Error('Method not implemented'); }
    async deleteOne() { throw new Error('Method not implemented'); }
}

class MongoRepository extends BaseRepository {
    constructor(collection) {
        super();
        this.collection = collection;
    }
    
    async find(query = {}) {
        return await this.collection.find(query).toArray();
    }
    
    async findOne(query) {
        return await this.collection.findOne(query);
    }
    
    async insertOne(document) {
        return await this.collection.insertOne(document);
    }
    
    async updateOne(filter, update) {
        return await this.collection.updateOne(filter, update);
    }
    
    async deleteOne(query) {
        return await this.collection.deleteOne(query);
    }
}

class AuthDecorator {
    constructor(authService) {
        this.authService = authService;
    }
    
    async verifyToken(req, res, next) {
        try {
            await this.authService.verifyToken(req, res, next);
        } catch (error) {
            res.status(401).send({ message: 'Authentication Failed' });
        }
    }
    
    async verifyAdmin(req, res, next) {
        try {
            await this.authService.verifyAdmin(req, res, next);
        } catch (error) {
            res.status(403).send({ message: 'Admin Access Required' });
        }
    }
}

class BookingObserver {
    constructor() {
        this.observers = [];
    }
    
    subscribe(observer) {
        this.observers.push(observer);
    }
    
    unsubscribe(observer) {
        this.observers = this.observers.filter(obs => obs !== observer);
    }
    
    async notify(bookingData) {
        for (const observer of this.observers) {
            await observer.update(bookingData);
        }
    }
}

class CollectionProxy {
    constructor(collection) {
        this.collection = collection;
        this.cache = new Map();
    }
    
    async findOne(query) {
        const cacheKey = JSON.stringify(query);
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        const result = await this.collection.findOne(query);
        this.cache.set(cacheKey, result);
        return result;
    }
    
    find(query = {}) {
        return this.collection.find(query); // Return cursor instead of toArray
    }
    
    async insertOne(document) {
        this.cache.clear();
        return await this.collection.insertOne(document);
    }
    
    async updateOne(filter, update) {
        this.cache.clear();
        return await this.collection.updateOne(filter, update);
    }
    
    async deleteOne(query) {
        this.cache.clear();
        return await this.collection.deleteOne(query);
    }
}

app.use(cors({
    origin: ['http://localhost:5173', 'https://travel-tour-auth.web.app'],
    credentials: true
}));
app.use(express.json());

async function run() {
    try {
        const db = DatabaseSingleton.getInstance().client.db("travelTourDB");
        
        const packageCollection = new CollectionProxy(CollectionFactory.createCollection('packages', db));
        const guideCollection = new CollectionProxy(CollectionFactory.createCollection('guides', db));
        const bookingCollection = new CollectionProxy(CollectionFactory.createCollection('bookings', db));
        const reviewCollection = new CollectionProxy(CollectionFactory.createCollection('reviews', db));
        const storyCollection = new CollectionProxy(CollectionFactory.createCollection('stories', db));
        const wishListCollection = new CollectionProxy(CollectionFactory.createCollection('wishLists', db));
        const userCollection = new CollectionProxy(CollectionFactory.createCollection('users', db));

        const userRepo = new MongoRepository(userCollection);
        const packageRepo = new MongoRepository(packageCollection);
        const guideRepo = new MongoRepository(guideCollection);
        const bookingRepo = new MongoRepository(bookingCollection);
        const reviewRepo = new MongoRepository(reviewCollection);
        const storyRepo = new MongoRepository(storyCollection);
        const wishListRepo = new MongoRepository(wishListCollection);

        const bookingObserver = new BookingObserver();
        const notificationObserver = {
            async update(bookingData) {
                console.log(`New booking notification: ${JSON.stringify(bookingData)}`);
            }
        };
        bookingObserver.subscribe(notificationObserver);

        const authService = {
            verifyToken: async (req, res, next) => {
                if (!req.headers.authorization) {
                    return res.status(401).send({ message: 'Forbidden Access' });
                }
                const token = req.headers.authorization.split(' ')[1];
                jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                    if (err) {
                        return res.status(401).send({ message: "Forbidden Access" });
                    }
                    req.decoded = decoded;
                    next();
                });
            },
            verifyAdmin: async (req, res, next) => {
                const email = req.decoded.email;
                const query = { email: email };
                const user = await userRepo.findOne(query);
                if (!user?.role === 'admin') {
                    return res.status(403).send({ message: 'Forbidden access' });
                }
                next();
            }
        };

        const decoratedAuth = new AuthDecorator(authService);

        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        });

        app.get('/users/admin/:email', decoratedAuth.verifyToken.bind(decoratedAuth), async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded?.email) {
                return res.status(403).send({ message: 'Unauthorized Access' });
            }
            const user = await userRepo.findOne({ email });
            res.send({ admin: user?.role === 'admin' });
        });

        app.get('/users/guide/:email', decoratedAuth.verifyToken.bind(decoratedAuth), async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded?.email) {
                return res.status(403).send({ message: 'Unauthorized Access' });
            }
            const user = await userRepo.findOne({ email });
            res.send({ tourGuide: user?.role === 'guide' });
        });

        app.post('/users', async (req, res) => {
            const user = req.body;
            const existingUser = await userRepo.findOne({ email: user?.email });
            if (existingUser) {
                return res.send({ message: 'User already exists', insertedId: null });
            }
            const result = await userRepo.insertOne(user);
            res.send(result);
        });

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = { $set: { role: 'admin' } };
            const result = await userRepo.updateOne(filter, updatedDoc);
            res.send(result);
        });

        app.patch('/users/guide/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = { $set: { role: 'guide' } };
            const result = await userRepo.updateOne(filter, updatedDoc);
            res.send(result);
        });

        app.get('/packages', async (req, res) => {
            const result = await packageRepo.find();
            res.send(result);
        });

        app.get('/allUsers', async (req, res) => {
            const result = await userRepo.find();
            res.send(result);
        });

        app.post('/packages', async (req, res) => {
            const result = await packageRepo.insertOne(req.body);
            res.send(result);
        });

        app.get('/packages/:id', async (req, res) => {
            const result = await packageRepo.findOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });

        app.get('/guides', async (req, res) => {
            const result = await guideRepo.find();
            res.send(result);
        });

        app.get('/stories', async (req, res) => {
            const result = await storyRepo.find();
            res.send(result);
        });

        app.get('/stories/:id', async (req, res) => {
            const result = await storyRepo.findOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });

        app.get('/guides/:id', async (req, res) => {
            const result = await guideRepo.findOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });

        app.post('/guides', decoratedAuth.verifyToken.bind(decoratedAuth), decoratedAuth.verifyAdmin.bind(decoratedAuth), async (req, res) => {
            const result = await guideRepo.insertOne(req.body);
            res.send(result);
        });

        app.post('/bookings', decoratedAuth.verifyToken.bind(decoratedAuth), async (req, res) => {
            const result = await bookingRepo.insertOne(req.body);
            await bookingObserver.notify(req.body);
            res.send(result);
        });

        app.get('/bookings', async (req, res) => {
            const result = await bookingRepo.find();
            res.send(result);
        });

        app.post('/stories', async (req, res) => {
            const result = await storyRepo.insertOne(req.body);
            res.send(result);
        });

        app.post('/reviews', async (req, res) => {
            const result = await reviewRepo.insertOne(req.body);
            res.send(result);
        });

        app.post('/wishLists', async (req, res) => {
            const result = await wishListRepo.insertOne(req.body);
            res.send(result);
        });

        app.get('/bookings/users', async (req, res) => {
            const query = { email: req.query.email };
            const result = await bookingRepo.find(query);
            res.send(result);
        });

        app.get('/wishLists', async (req, res) => {
            const query = { userEmail: req.query.email };
            const result = await wishListRepo.find(query);
            res.send(result);
        });

        app.delete('/wishLists/:id', async (req, res) => {
            const query = { _id: new ObjectId(req.params.id) };
            const result = await wishListRepo.deleteOne(query);
            res.send(result);
        });

        app.delete('/bookings/:id', async (req, res) => {
            const query = { _id: new ObjectId(req.params.id) };
            const result = await bookingRepo.deleteOne(query);
            res.send(result);
        });

        app.patch('/bookings/guide/reject/:id', async (req, res) => {
            const filter = { _id: new ObjectId(req.params.id) };
            const updatedDoc = { $set: { status: 'Rejected' } };
            const result = await bookingRepo.updateOne(filter, updatedDoc);
            res.send(result);
        });

        app.patch('/bookings/guide/accept/:id', async (req, res) => {
            const filter = { _id: new ObjectId(req.params.id) };
            const updatedDoc = { $set: { status: 'Accepted' } };
            const result = await bookingRepo.updateOne(filter, updatedDoc);
            res.send(result);
        });

        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {}
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Travel Tour is running!');
});

app.listen(port, () => {
    console.log(`Travel Tour is running on port ${port}`);
});
