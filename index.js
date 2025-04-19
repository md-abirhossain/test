const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7nwjyzo.mongodb.net/?retryWrites=true&w=majority`;

const DatabaseClient = (function () {
  let instance;

  async function createInstance() {
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });

    try {
      console.log("Database client initialized");
    } catch (error) {
      console.error("Error initializing database client:", error);
    }

    return client;
  }

  return {
    getInstance: async function () {
      if (!instance) {
        instance = await createInstance();
      }
      return instance;
    },
  };
})();

class RepositoryFactory {
  constructor(client) {
    this.client = client;
  }

  createPackageRepository() {
    throw new Error("Method 'createPackageRepository' must be implemented");
  }

  createUserRepository() {
    throw new Error("Method 'createUserRepository' must be implemented");
  }

  createBookingRepository() {
    throw new Error("Method 'createBookingRepository' must be implemented");
  }
}

class Repository {
  constructor(client, collectionName) {
    this.collection = client.db("travelTourDB").collection(collectionName);
  }

  async findAll() {
    return await this.collection.find().toArray();
  }

  async findById(id) {
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async create(data) {
    return await this.collection.insertOne(data);
  }

  async update(id, data) {
    return await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: data });
  }

  async delete(id) {
    return await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}

class MongoPackageRepository extends Repository {
  constructor(client) {
    super(client, "packages");
  }
}

class MongoUserRepository extends Repository {
  constructor(client) {
    super(client, "users");
  }

  async findByEmail(email) {
    return await this.collection.findOne({ email });
  }

  async updateRole(id, role) {
    return await this.collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );
  }
}

class MongoBookingRepository extends Repository {
  constructor(client) {
    super(client, "bookings");
  }

  async findByEmail(email) {
    return await this.collection.find({ email }).toArray();
  }

  async updateStatus(id, status) {
    return await this.collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );
  }
}

class MongoGuideRepository extends Repository {
  constructor(client) {
    super(client, "guides");
  }
}

class MongoReviewRepository extends Repository {
  constructor(client) {
    super(client, "reviews");
  }
}

class MongoStoryRepository extends Repository {
  constructor(client) {
    super(client, "stories");
  }
}

class MongoWishListRepository extends Repository {
  constructor(client) {
    super(client, "wishLists");
  }

  async findByUserEmail(email) {
    return await this.collection.find({ userEmail: email }).toArray();
  }
}

class MongoRepositoryFactory extends RepositoryFactory {
  constructor(client) {
    super(client);
  }

  createPackageRepository() {
    return new MongoPackageRepository(this.client);
  }

  createUserRepository() {
    return new MongoUserRepository(this.client);
  }

  createBookingRepository() {
    return new MongoBookingRepository(this.client);
  }

  createGuideRepository() {
    return new MongoGuideRepository(this.client);
  }

  createReviewRepository() {
    return new MongoReviewRepository(this.client);
  }

  createStoryRepository() {
    return new MongoStoryRepository(this.client);
  }

  createWishListRepository() {
    return new MongoWishListRepository(this.client);
  }
}

class BaseMiddleware {
  constructor(middleware) {
    this.middleware = middleware;
  }

  handle(req, res, next) {
    this.middleware(req, res, next);
  }
}

class LoggingMiddleware extends BaseMiddleware {
  constructor(middleware) {
    super(middleware);
  }

  handle(req, res, next) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    super.handle(req, res, next);
  }
}

class TokenVerificationMiddleware extends BaseMiddleware {
  constructor(middleware, secret) {
    super(middleware);
    this.secret = secret;
  }

  handle(req, res, next) {
    if (!req.headers.authorization) {
      return res.status(401).send({ message: 'Forbidden Access' });
    }

    const token = req.headers.authorization.split(' ')[1];
    jwt.verify(token, this.secret, (err, decoded) => {
      if (err) {
        return res.status(401).send({ message: "Forbidden Access" });
      }
      req.decoded = decoded;
      super.handle(req, res, next);
    });
  }
}

class RoleCheckMiddleware extends BaseMiddleware {
  constructor(middleware, role, userRepository) {
    super(middleware);
    this.role = role;
    this.userRepository = userRepository;
  }

  async handle(req, res, next) {
    const email = req.decoded.email;
    const user = await this.userRepository.findByEmail(email);

    if (user?.role !== this.role) {
      return res.status(403).send({ message: 'Forbidden access' });
    }

    super.handle(req, res, next);
  }
}

class EventEmitter {
  constructor() {
    this.listeners = {};
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(callback => callback(data));
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }
}

class PaymentStrategy {
  process(amount, currency) {
    throw new Error("Method 'process' must be implemented");
  }
}

class StripePaymentStrategy extends PaymentStrategy {
  process(amount, currency) {
    console.log(`Processing ${amount} ${currency} payment with Stripe`);
    return { success: true, gateway: 'stripe', transactionId: `stripe-${Date.now()}` };
  }
}

class PayPalPaymentStrategy extends PaymentStrategy {
  process(amount, currency) {
    console.log(`Processing ${amount} ${currency} payment with PayPal`);
    return { success: true, gateway: 'paypal', transactionId: `paypal-${Date.now()}` };
  }
}

class BkashPaymentStrategy extends PaymentStrategy {
  process(amount, currency) {
    console.log(`Processing ${amount} ${currency} payment with bKash`);
    return { success: true, gateway: 'bkash', transactionId: `bkash-${Date.now()}` };
  }
}

class PaymentProcessor {
  constructor(strategy) {
    this.strategy = strategy;
  }

  setStrategy(strategy) {
    this.strategy = strategy;
  }

  processPayment(amount, currency) {
    return this.strategy.process(amount, currency);
  }
}

class ServiceFactory {
  static createAuthService(userRepository) {
    return new AuthService(userRepository);
  }

  static createBookingService(bookingRepository, eventEmitter) {
    return new BookingService(bookingRepository, eventEmitter);
  }

  static createPackageService(packageRepository) {
    return new PackageService(packageRepository);
  }
}

class AuthService {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async generateToken(user) {
    return jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
  }

  async registerUser(userData) {
    const existingUser = await this.userRepository.findByEmail(userData.email);
    if (existingUser) {
      return { message: 'User already exists', insertedId: null };
    }
    return await this.userRepository.create(userData);
  }

  async checkRole(email, role) {
    const user = await this.userRepository.findByEmail(email);
    return user?.role === role;
  }
}

class BookingService {
  constructor(bookingRepository, eventEmitter) {
    this.bookingRepository = bookingRepository;
    this.eventEmitter = eventEmitter;
  }

  async createBooking(bookingData) {
    const result = await this.bookingRepository.create(bookingData);
    this.eventEmitter.emit('booking:created', { booking: bookingData, id: result.insertedId });
    return result;
  }

  async getUserBookings(email) {
    return await this.bookingRepository.findByEmail(email);
  }

  async updateBookingStatus(id, status) {
    const result = await this.bookingRepository.updateStatus(id, status);
    this.eventEmitter.emit('booking:statusChanged', { id, status });
    return result;
  }

  async deleteBooking(id) {
    const booking = await this.bookingRepository.findById(id);
    const result = await this.bookingRepository.delete(id);
    this.eventEmitter.emit('booking:deleted', { id, booking });
    return result;
  }
}

class PackageService {
  constructor(packageRepository) {
    this.packageRepository = packageRepository;
  }

  async getAllPackages() {
    return await this.packageRepository.findAll();
  }

  async getPackageById(id) {
    return await this.packageRepository.findById(id);
  }

  async createPackage(packageData) {
    return await this.packageRepository.create(packageData);
  }
}

const startServer = async () => {
  const client = await DatabaseClient.getInstance();
  const factory = new MongoRepositoryFactory(client);
  const userRepo = factory.createUserRepository();
  const packageRepo = factory.createPackageRepository();
  const bookingRepo = factory.createBookingRepository();

  const authService = ServiceFactory.createAuthService(userRepo);
  const bookingService = ServiceFactory.createBookingService(bookingRepo, new EventEmitter());
  const packageService = ServiceFactory.createPackageService(packageRepo);

  app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await userRepo.findByEmail(email);
    if (user && user.password === password) {
      const token = await authService.generateToken({ email, role: user.role });
      res.json({ token });
    } else {
      res.status(401).json({ message: "Invalid credentials" });
    }
  });

  app.post('/register', async (req, res) => {
    const { email, password, role } = req.body;
    const result = await authService.registerUser({ email, password, role });
    res.json(result);
  });

  app.get('/packages', async (req, res) => {
    const packages = await packageService.getAllPackages();
    res.json(packages);
  });

  app.post('/bookings', async (req, res) => {
    const bookingData = req.body;
    const result = await bookingService.createBooking(bookingData);
    res.json(result);
  });

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
};

startServer().catch(console.error);
