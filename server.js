const express = require("express");
const mysql = require("mysql");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const cors = require("cors");

// Tạo ứng dụng Express
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Kết nối MySQL
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "shop_db",
});

db.connect((err) => {
  if (err) throw err;
  console.log("MySQL Connected...");
});

// Middleware xác thực JWT
const verifyToken = (req, res, next) => {
  const token = req.headers["x-access-token"];
  if (!token)
    return res.status(403).send({ auth: false, message: "No token provided." });

  jwt.verify(token, "secret_key", (err, decoded) => {
    if (err)
      return res
        .status(500)
        .send({ auth: false, message: "Failed to authenticate token." });
    req.userId = decoded.id;
    req.userRole = decoded.role;
    next();
  });
};

// Route đăng ký
app.post("/register", (req, res) => {
  const { username, email, password, role = "customer" } = req.body; // Mặc định role là customer
  const hashedPassword = bcrypt.hashSync(password, 8);

  const sql =
    "INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)";
  db.query(sql, [username, email, hashedPassword, role], (err, result) => {
    if (err) return res.status(500).send(err);
    res.status(201).send({ message: "User registered" });
  });
});

// Route đăng nhập
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  const sql = "SELECT * FROM users WHERE email = ?";
  db.query(sql, [email], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.length === 0)
      return res.status(404).send({ message: "User not found" });

    const user = result[0];
    const passwordIsValid = bcrypt.compareSync(password, user.password);
    if (!passwordIsValid)
      return res.status(401).send({ token: null, message: "Invalid password" });

    // Tạo token và gửi phản hồi với user_id, username
    const token = jwt.sign({ id: user.id, role: user.role }, "secret_key", {
      expiresIn: 86400,
    });
    res.status(200).send({
      token,
      role: user.role,
      username: user.username,
      user_id: user.id,
    }); // Cập nhật phản hồi
  });
});

// Route tạo sản phẩm (chỉ admin)
app.post("/products", verifyToken, (req, res) => {
  if (req.userRole !== "admin")
    return res.status(403).send({ message: "Access denied" });

  const { category_id, name, description, price, stock, image_url } = req.body;

  const sql =
    "INSERT INTO products (category_id, name, description, price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?)";
  db.query(
    sql,
    [category_id, name, description, price, stock, image_url],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.status(201).send({ message: "Product created" });
    }
  );
});

// Route lấy danh sách sản phẩm
app.get("/products", (req, res) => {
  const sql = "SELECT * FROM products";
  db.query(sql, (err, result) => {
    if (err) return res.status(500).send(err);
    res.status(200).send(result);
  });
});

// Route lấy chi tiết sản phẩm
app.get("/products/:id", (req, res) => {
  const sql = "SELECT * FROM products WHERE id = ?";
  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.length === 0)
      return res.status(404).send({ message: "Product not found" });
    res.status(200).send(result[0]);
  });
});

// Route tạo giỏ hàng (người dùng)
app.post("/cart", verifyToken, (req, res) => {
  const { product_id, quantity } = req.body;
  const findUser = "SELECT * FROM carts WHERE user_id = ?";
  db.query(findUser, [req.userId], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.length == 0) {
      const sql = "INSERT INTO carts (user_id, created_at) VALUES (?, NOW())";
      db.query(sql, [req.userId], (err, result) => {
        if (err) return res.status(500).send(err);
        const cartId = result.insertId;
        const sqlCartItem =
          "INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)";
        db.query(sqlCartItem, [cartId, product_id, quantity], (err) => {
          if (err) return res.status(500).send(err);
          res.status(201).send({ message: "Product added to cart" });
        });
      });
    } else {
      const cartId = result[0].id;
      const findCartItem = "SELECT * FROM cart_items WHERE cart_id = ?";
      db.query(findCartItem, [cartId], (err, result) => {
        if (err) return res.status(500).send(err);
        if (result.length == 0) {
          const sqlCartItem =
            "INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)";
          db.query(sqlCartItem, [cartId, product_id, quantity], (err) => {
            if (err) return res.status(500).send(err);
            res.status(201).send({ message: "Product added to cart" });
          });
        } else if (result.length > 0) {
          let haveProduct = false;
          result.forEach((item) => {
            if (item.product_id == product_id) {
              haveProduct = true;
              const sqlCartItem =
                "UPDATE cart_items SET quantity = quantity + ? WHERE cart_id = ? AND product_id = ?";
              db.query(sqlCartItem, [quantity, cartId, product_id], (err) => {
                if (err) return res.status(500).send(err);
                res.status(201).send({ message: "Product added to cart" });
              });
            }
            if (!haveProduct) {
              const sqlCartItem =
                "INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)";
              db.query(sqlCartItem, [cartId, product_id, quantity], (err) => {
                if (err) return res.status(500).send(err);
                res.status(201).send({ message: "Product added to cart" });
              });
            }
          });
        }
      });
    }
  });
});

// Route lấy danh sách sản phẩm trong giỏ hàng
app.post("/getCart", verifyToken, (req, res) => {
  const sql = `
    SELECT ci.id, ci.product_id, p.name, p.image_url, p.price, ci.quantity
    FROM cart_items ci
    JOIN carts c ON ci.cart_id = c.id
    JOIN products p ON ci.product_id = p.id
    WHERE c.user_id = ?
  `;
  db.query(sql, [req.body.userId], (err, result) => {
    if (err) return res.status(500).send(err);
    res.status(200).send(result);
  });
});

// Route xóa sản phẩm khỏi giỏ hàng
app.delete("/cart/:id", verifyToken, (req, res) => {
  const sql = "DELETE FROM cart_items WHERE id = ?";
  db.query(sql, [req.params.id], (err) => {
    if (err) return res.status(500).send(err);
    res.status(200).send({ message: "Product deleted from cart" });
  });
});

// Route đặt hàng (người dùng)
app.post("/orders", verifyToken, (req, res) => {
  const { cart_items, total_price } = req.body;

  const sqlOrder =
    "INSERT INTO orders (user_id, total_price, status) VALUES (?, ?, 'pending')";
  db.query(sqlOrder, [req.userId, total_price], (err, result) => {
    if (err) return res.status(500).send(err);
    const orderId = result.insertId;

    cart_items.forEach((item) => {
      const sqlOrderItem =
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)";
      db.query(
        sqlOrderItem,
        [orderId, item.product_id, item.quantity, item.price],
        (err) => {
          if (err) return res.status(500).send(err);
        }
      );
    });

    res.status(201).send({ message: "Order placed", orderId });
  });
});

// Route xem danh sách đơn hàng (người dùng)
app.get("/orders", verifyToken, (req, res) => {
  const sql = "SELECT * FROM orders WHERE user_id = ?";
  db.query(sql, [req.userId], (err, result) => {
    if (err) return res.status(500).send(err);
    res.status(200).send(result);
  });
});

// Route tạo danh mục sản phẩm (chỉ admin)
// Route thêm danh mục
app.post("/categories", verifyToken, (req, res) => {
  if (req.userRole !== "admin")
    return res.status(403).send({ message: "Access denied" });

  const { name, description } = req.body;
  const sql = "INSERT INTO categories (name, description) VALUES (?, ?)";
  db.query(sql, [name, description], (err, result) => {
    if (err) return res.status(500).send(err);
    res.status(201).send({ message: "Category created" });
  });
});

// Route lấy danh sách danh mục
app.get("/categories", (req, res) => {
  const sql = "SELECT * FROM categories";
  db.query(sql, (err, result) => {
    if (err) return res.status(500).send(err);
    res.status(200).send(result);
  });
});

// Route cập nhật danh mục
app.put("/categories/:id", verifyToken, (req, res) => {
  if (req.userRole !== "admin")
    return res.status(403).send({ message: "Access denied" });

  const { name, description } = req.body;
  const id = req.params.id;
  const sql = "UPDATE categories SET name = ?, description = ? WHERE id = ?";

  db.query(sql, [name, description, id], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.affectedRows === 0)
      return res.status(404).send({ message: "Category not found" });
    res.status(200).send({ message: "Category updated" });
  });
});

// Route xóa danh mục
app.delete("/categories/:id", verifyToken, (req, res) => {
  if (req.userRole !== "admin")
    return res.status(403).send({ message: "Access denied" });

  const id = req.params.id;
  const sql = "DELETE FROM categories WHERE id = ?";

  db.query(sql, [id], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.affectedRows === 0)
      return res.status(404).send({ message: "Category not found" });
    res.status(204).send(); // Trả về 204 No Content khi xóa thành công
  });
});

// Route lấy danh mục theo ID
app.get("/categories/:id", (req, res) => {
  const id = req.params.id;
  const sql = "SELECT * FROM categories WHERE id = ?";

  db.query(sql, [id], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.length === 0)
      return res.status(404).send({ message: "Category not found" });
    res.status(200).send(result[0]); // Trả về danh mục
  });
});

// Route xóa sản phẩm (chỉ admin)
app.delete("/products/:id", verifyToken, (req, res) => {
  if (req.userRole !== "admin")
    return res.status(403).send({ message: "Access denied" });

  const sql = "DELETE FROM products WHERE id = ?";
  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.affectedRows === 0)
      return res.status(404).send({ message: "Product not found" });
    res.status(200).send({ message: "Product deleted successfully" });
  });
});

// Chạy ứng dụng trên cổng 3000
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
